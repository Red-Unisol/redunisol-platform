import { SocioMutualLegacyUnavailableError } from "../../domain/socios-errors";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

type EvaluateListSociosMutualGatewayConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export type SocioMutualPullRow = {
  apellido: string | null;
  celular: string | null;
  cuit: string | null;
  email: string | null;
  fechaDeNacimiento: string | null;
  id: number | null;
  nombre: string | null;
  nombreCompleto: string | null;
  nroDoc: string | null;
  sexo: string | null;
  tipoDocDescripcion: string | null;
};

type EvaluateListPrimitive = boolean | null | number | string;
type EvaluateListRow = EvaluateListPrimitive[];

const EVALUATE_LIST_PATH = "/api/Empresa/EvaluateList";
const SOCIO_MUTUAL_TIPO = "F.Module.SocioMutual";

// El orden define la posicion de cada valor en las filas que devuelve
// EvaluateList (respuesta posicional, no objetos con clave) -- ver
// EvaluateListSolicitudesGateway para el mismo patron ya validado contra la
// API real.
//
// "TipoDoc.Descripcion" es el discriminador real fisica/juridica -- "CUIT"
// para juridica, "DNI" (u otro tipo real) para fisica. Confirmado contra dos
// registros reales conocidos en Vimax (ID 152198 fisica / 152199 juridica).
// "Sexo" NO sirve para esto: EvaluateList devuelve un codigo numerico interno
// (no el string "PersonaJuridica" que se manda al dar de alta), y el mismo
// codigo puede repetirse entre fisica y juridica.
const FIELDS = [
  "ID",
  "NroDoc",
  "CUIT",
  "Nombre",
  "Apellido",
  "NombreCompleto",
  "FechaDeNacimiento",
  "Sexo",
  "TipoDoc.Descripcion",
  "Celular",
  "Email",
] as const;

const FIELD_INDEX = buildFieldIndexByName(FIELDS);

export class EvaluateListSociosMutualGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(
    config: EvaluateListSociosMutualGatewayConfig,
    fetcher: Fetcher = fetch,
  ) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async fetchPage(
    cursorId: number,
    batchSize: number,
  ): Promise<SocioMutualPullRow[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(
        new URL(EVALUATE_LIST_PATH, this.baseUrl),
        {
          body: JSON.stringify({
            campos: FIELDS.join(";"),
            cmd: `[ID] > ${cursorId}`,
            max: batchSize,
            tipo: SOCIO_MUTUAL_TIPO,
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
        .map(mapRow);
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

function buildFieldIndexByName(fields: readonly string[]) {
  return fields.reduce<Record<string, number>>((accumulator, field, index) => {
    accumulator[field] = index;
    return accumulator;
  }, {});
}

function getValue(row: EvaluateListRow, fieldName: string): EvaluateListPrimitive {
  const index = FIELD_INDEX[fieldName];

  if (index === undefined) {
    return null;
  }

  return row[index] ?? null;
}

function getStringValue(row: EvaluateListRow, fieldName: string): string | null {
  const value = getValue(row, fieldName);

  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : String(value);
}

function getNumberValue(row: EvaluateListRow, fieldName: string): number | null {
  const value = getValue(row, fieldName);

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numericValue = Number(value);
    return Number.isNaN(numericValue) ? null : numericValue;
  }

  return null;
}

function mapRow(row: EvaluateListRow): SocioMutualPullRow {
  return {
    apellido: getStringValue(row, "Apellido"),
    celular: getStringValue(row, "Celular"),
    cuit: getStringValue(row, "CUIT"),
    email: getStringValue(row, "Email"),
    fechaDeNacimiento: getStringValue(row, "FechaDeNacimiento"),
    id: getNumberValue(row, "ID"),
    nombre: getStringValue(row, "Nombre"),
    nombreCompleto: getStringValue(row, "NombreCompleto"),
    nroDoc: getStringValue(row, "NroDoc"),
    sexo: getStringValue(row, "Sexo"),
    tipoDocDescripcion: getStringValue(row, "TipoDoc.Descripcion"),
  };
}
