import {
  PrestamoLegacyRechazadoError,
  PrestamoLegacyUnavailableError,
} from "../../domain/solicitudes-core-errors";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

type CrearPrestamoGatewayConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export type CrearPrestamoIntegrante = {
  socio: string;
  tipoRelacion: "Titular";
};

export type CrearPrestamoInput = {
  cuotas: number;
  fechaEmision: string;
  integrantes: CrearPrestamoIntegrante[];
  lineaPrestamo: string;
  montoDeseado: string;
  vendedor: string;
};

export type CrearPrestamoResult = {
  id: string;
};

const CREAR_PRESTAMO_PATH = "/api/Simulador/CrearPrestamo";

export class CrearPrestamoGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(config: CrearPrestamoGatewayConfig, fetcher: Fetcher = fetch) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async crear(input: CrearPrestamoInput): Promise<CrearPrestamoResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Awaited<ReturnType<Fetcher>>;

    try {
      response = await this.fetcher(
        new URL(CREAR_PRESTAMO_PATH, this.baseUrl),
        {
          body: JSON.stringify({
            campos: {
              Cuotas: input.cuotas,
              FechaEmision: input.fechaEmision,
              Integrantes: input.integrantes.map((integrante) => ({
                Socio: integrante.socio,
                TipoRelacion: integrante.tipoRelacion,
              })),
              LineaPrestamo: input.lineaPrestamo,
              MontoDeseado: input.montoDeseado,
              Vendedor: input.vendedor,
            },
            validar: false,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        },
      );
    } catch {
      clearTimeout(timeoutId);
      throw new PrestamoLegacyUnavailableError();
    }

    clearTimeout(timeoutId);

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new PrestamoLegacyUnavailableError();
    }

    return this.parseResponse(body);
  }

  private parseResponse(body: unknown): CrearPrestamoResult {
    const row = body as Record<string, unknown>;

    if (row.Ok !== true) {
      const message =
        typeof row.Error === "string" && row.Error.trim().length > 0
          ? row.Error
          : "No se pudo dar de alta el préstamo en el legado.";

      throw new PrestamoLegacyRechazadoError(message);
    }

    return { id: String(row.ID) };
  }
}
