import type { LineaPrestamoLegacyIdResolver } from "../../domain/services/LineaPrestamoLegacyIdResolver";

type EvaluatePrimitive = boolean | null | number | string;
type EvaluateRow = EvaluatePrimitive[];

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

type Config = {
  baseUrl: string;
  timeoutMs: number;
};

const EVALUATE_LIST_PATH = "/api/Empresa/EvaluateList";
const LINEA_PRESTAMO_TIPO = "F.Module.Cuentas.Prestamos.LineaPrestamo";

export class EvaluateListLineaPrestamoLegacyIdResolver
  implements LineaPrestamoLegacyIdResolver
{
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(config: Config, fetcher: Fetcher = fetch) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async resolveByPresolicitudOid(
    presolicitudOid: string,
  ): Promise<string | null> {
    const oid = presolicitudOid.trim();

    // El Oid se interpola en la expresion de criterios, asi que solo se acepta
    // si es un entero. Cualquier otra cosa se rechaza antes de armar la query.
    if (!/^\d+$/.test(oid)) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(
        new URL(EVALUATE_LIST_PATH, this.baseUrl),
        {
          body: JSON.stringify({
            campos: "ID",
            // max 2 a proposito: con una fila alcanza para resolver, y la
            // segunda solo sirve para detectar que hay mas de una candidata.
            cmd: `[LineaSolicitud.Oid] = ${oid}`,
            max: 2,
            tipo: LINEA_PRESTAMO_TIPO,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        return null;
      }

      return this.mapResponse(await response.json());
    } catch {
      // Sin conectividad o con el legado caido no se puede resolver. Devolver
      // null hace que el caso de uso aborte, que es lo que queremos: es
      // preferible no crear el prestamo a crearlo con la linea equivocada.
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private mapResponse(body: unknown): string | null {
    if (!Array.isArray(body) || body.length !== 1) {
      return null;
    }

    const row = body[0] as EvaluateRow;

    if (!Array.isArray(row)) {
      return null;
    }

    const value = row[0];

    if (typeof value === "number" && Number.isInteger(value)) {
      return String(value);
    }

    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      return value.trim();
    }

    return null;
  }
}
