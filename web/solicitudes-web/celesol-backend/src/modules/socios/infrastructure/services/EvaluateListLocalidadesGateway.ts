import { SocioMutualLegacyUnavailableError } from "../../domain/socios-errors";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

type EvaluateListLocalidadesGatewayConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export type LocalidadLegacy = {
  codigoPostal: string | null;
  id: string;
  nombre: string;
  provincia: string | null;
};

type EvaluateListPrimitive = boolean | null | number | string;
type EvaluateListRow = EvaluateListPrimitive[];

const EVALUATE_LIST_PATH = "/api/Empresa/EvaluateList";
const LOCALIDAD_TIPO = "ClasesBase.Localidad";
// La tabla tiene ~22.200 localidades (relevado 2026-10-13); el tope deja
// margen. EvaluateList con max <= 0 devuelve una sola fila.
const LOCALIDADES_MAX = 50000;

// Posicional, como el resto de los gateways de EvaluateList.
const FIELDS = ["ID", "Nombre", "CodigoPostal", "Provincia.Nombre"] as const;

export class EvaluateListLocalidadesGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(
    config: EvaluateListLocalidadesGatewayConfig,
    fetcher: Fetcher = fetch,
  ) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async fetchAll(): Promise<LocalidadLegacy[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(
        new URL(EVALUATE_LIST_PATH, this.baseUrl),
        {
          body: JSON.stringify({
            campos: FIELDS.join(";"),
            cmd: "[ID] > 0",
            max: LOCALIDADES_MAX,
            tipo: LOCALIDAD_TIPO,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new SocioMutualLegacyUnavailableError();
      }

      const body = await response.json();

      if (!Array.isArray(body)) {
        throw new SocioMutualLegacyUnavailableError();
      }

      return body
        .filter((row): row is EvaluateListRow => Array.isArray(row))
        .map(mapRow)
        .filter((row): row is LocalidadLegacy => row !== null);
    } catch (error) {
      if (error instanceof SocioMutualLegacyUnavailableError) {
        throw error;
      }

      throw new SocioMutualLegacyUnavailableError();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function toText(value: EvaluateListPrimitive | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function mapRow(row: EvaluateListRow): LocalidadLegacy | null {
  const id = toText(row[0]);
  const nombre = toText(row[1]);

  if (!id || !nombre) {
    return null;
  }

  return {
    codigoPostal: toText(row[2]),
    id,
    nombre,
    provincia: toText(row[3]),
  };
}
