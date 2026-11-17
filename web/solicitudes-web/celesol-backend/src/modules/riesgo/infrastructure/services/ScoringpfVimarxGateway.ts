import { CalculadoraMutualLegacyUnavailableError } from "../../domain/riesgo-errors";

/** Nombre de la planilla de Riesgo en Vimarx (Reportes > Hojas calculo). */
const NOMBRE_PLANILLA = "SCORINGPF";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{ json(): Promise<unknown>; ok: boolean }>;

/**
 * Baja de Vimarx la planilla SCORINGPF (ClasesBase.HojaCalculo, campo Hoja en
 * base64). Solo lectura: usa EvaluateList.
 */
export class ScoringpfVimarxGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(
    config: { baseUrl: string; timeoutMs: number },
    fetcher: Fetcher = fetch,
  ) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async descargar(): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let filas: unknown;

    try {
      const response = await this.fetcher(
        new URL("/api/Empresa/EvaluateList", this.baseUrl).toString(),
        {
          body: JSON.stringify({
            campos: "ID;Nombre;Hoja",
            cmd: `[Nombre] = '${NOMBRE_PLANILLA}'`,
            max: 2,
            tipo: "HojaCalculo",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new CalculadoraMutualLegacyUnavailableError();
      }

      filas = await response.json();
      // A veces Fapi devuelve el JSON como texto.
      if (typeof filas === "string") {
        filas = JSON.parse(filas);
      }
    } catch {
      throw new CalculadoraMutualLegacyUnavailableError();
    } finally {
      clearTimeout(timeoutId);
    }

    if (
      !Array.isArray(filas) ||
      filas.length !== 1 ||
      !Array.isArray(filas[0]) ||
      typeof filas[0][2] !== "string" ||
      filas[0][2].length === 0
    ) {
      throw new CalculadoraMutualLegacyUnavailableError();
    }

    return Buffer.from(filas[0][2], "base64");
  }
}
