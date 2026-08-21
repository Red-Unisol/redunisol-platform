import type { CalculadoraMutualDatos } from "../../domain/entities/CalculadoraMutual.entity";
import {
  CalculadoraMutualLegacyUnavailableError,
  SolicitudNotFoundError,
} from "../../domain/riesgo-errors";

type EvaluatePrimitive = boolean | null | number | string;
type EvaluateRow = EvaluatePrimitive[];

type EvaluateListDefinition<TResult> = {
  buildCmd: () => string;
  fields: readonly string[];
  mapRow: (row: EvaluateRow) => TResult;
  tipo: string;
};

type CalculadoraMutualLegacyGatewayConfig = {
  baseUrl: string;
  timeoutMs: number;
};

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

const SOLICITUD_SNAPSHOT_FIELDS = [
  "Oid",
  "NroSolicitud",
  "Fecha",
  "NombreCompleto",
  "NroDocumento",
  "CUIT",
  "MontoAFinanciar",
  "Cuotas",
  "CuotaResultante",
  "FechaPrimerVencimiento",
  "LineaPrestamo.ID",
  "LineaPrestamo.Descripcion",
  "LineaPrestamo.[Terminos y condiciones].Descripcion",
  "VendedorSolicitud.Nombre",
  "MontoRecibo",
  "Antiguedad",
  "CupoTitular",
] as const;

const SOCIO_INDICADORES_FIELDS = [
  "ID",
  "CUIT",
  "[Renovaciones Final]",
  "[Rechazos en el Mes]",
] as const;

const TITULAR_NUEVO_FIELDS = ["ID"] as const;
const SALDO_PRESTAMOS_FIELDS = ["DeudaTotal"] as const;
const COMPROMISO_MENSUAL_FIELDS = ["MontoTotal"] as const;

const solicitudSnapshotFieldIndex = buildFieldIndexByName(
  SOLICITUD_SNAPSHOT_FIELDS,
);
const socioIndicadoresFieldIndex = buildFieldIndexByName(
  SOCIO_INDICADORES_FIELDS,
);
const titularNuevoFieldIndex = buildFieldIndexByName(TITULAR_NUEVO_FIELDS);
const saldoPrestamosFieldIndex = buildFieldIndexByName(
  SALDO_PRESTAMOS_FIELDS,
);
const compromisoMensualFieldIndex = buildFieldIndexByName(
  COMPROMISO_MENSUAL_FIELDS,
);

export type CalculadoraMutualSolicitudSnapshot = {
  antiguedadLaboral: number | null;
  convenio: string | null;
  cuitTitular: string | null;
  cuotaResultante: number | null;
  cuotas: number | null;
  cupoDisponibleVendedor: number | null;
  dniTitular: string | null;
  fechaPrimerVencimiento: string | null;
  fechaSolicitud: string | null;
  ingresos: number | null;
  lineaDescripcion: string | null;
  lineaId: number | null;
  montoAFinanciar: number | null;
  nombreCompletoTitular: string | null;
  nroSolicitud: string | null;
  vendedor: string | null;
};

export type CalculadoraMutualHistorialSocio = {
  compromisoMensualVigente: number | null;
  rechazosDelMes: number | null;
  saldoPrestamosVigentes: number | null;
  situacionSocio: string | null;
  titularNuevo: boolean | null;
};

export class CalculadoraMutualLegacyGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(
    config: CalculadoraMutualLegacyGatewayConfig,
    fetcher: Fetcher = fetch,
  ) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async getDatos(oid: string): Promise<CalculadoraMutualDatos> {
    const snapshot = await this.getSolicitudSnapshot(oid);
    const historial = await this.getHistorialByCuit(
      snapshot.cuitTitular,
      snapshot.fechaSolicitud,
    );

    return {
      ...snapshot,
      ...historial,
    };
  }

  /**
   * Datos de riesgo/historial de un socio (Situación, Rechazos, Titular
   * Nuevo, Saldo y Compromiso de préstamos). El core propio nunca los tiene
   * -- viven únicamente en el legado -- así que este método se reutiliza
   * tanto cuando el snapshot de la solicitud viene del legado como cuando
   * viene del core (buscando siempre por CUIT del titular).
   */
  async getHistorialByCuit(
    cuit: string | null,
    fechaSolicitud: string | null,
  ): Promise<CalculadoraMutualHistorialSocio> {
    if (!cuit) {
      return {
        compromisoMensualVigente: null,
        rechazosDelMes: null,
        saldoPrestamosVigentes: null,
        situacionSocio: null,
        titularNuevo: null,
      };
    }

    const [
      socioIndicadoresResult,
      titularNuevoResult,
      saldoPrestamosVigentesResult,
      compromisoMensualVigenteResult,
    ] = await Promise.allSettled([
      this.getSocioIndicadores(cuit),
      this.getTitularNuevo(cuit, fechaSolicitud),
      this.getSaldoPrestamosVigentes(cuit),
      this.getCompromisoMensualVigente(cuit),
    ]);

    const socioIndicadores = resolveSettled(socioIndicadoresResult, {
      rechazosDelMes: null,
      situacionSocio: null,
    });

    return {
      compromisoMensualVigente: resolveSettled(
        compromisoMensualVigenteResult,
        null,
      ),
      rechazosDelMes: socioIndicadores.rechazosDelMes,
      saldoPrestamosVigentes: resolveSettled(
        saldoPrestamosVigentesResult,
        null,
      ),
      situacionSocio: socioIndicadores.situacionSocio,
      titularNuevo: resolveSettled(titularNuevoResult, null),
    };
  }

  private async getSolicitudSnapshot(oid: string): Promise<CalculadoraMutualSolicitudSnapshot> {
    const rows = await this.executeEvaluateList<CalculadoraMutualSolicitudSnapshot>({
      buildCmd: () => `[Oid]=${oid}`,
      fields: SOLICITUD_SNAPSHOT_FIELDS,
      mapRow: mapSolicitudSnapshotRow,
      tipo: "PreSolicitud.Module.Solicitud",
    });

    const snapshot = rows[0];

    if (!snapshot) {
      throw new SolicitudNotFoundError();
    }

    return snapshot;
  }

  private async getSocioIndicadores(cuit: string) {
    const rows = await this.executeEvaluateList<{
      rechazosDelMes: number | null;
      situacionSocio: string | null;
    }>({
      buildCmd: () => `[CUIT]=${cuit}`,
      fields: SOCIO_INDICADORES_FIELDS,
      mapRow: mapSocioIndicadoresRow,
      tipo: "F.Module.SocioMutual",
    });

    return (
      rows[0] ?? {
        rechazosDelMes: null,
        situacionSocio: "SIN DATOS",
      }
    );
  }

  private async getTitularNuevo(cuit: string, fechaSolicitud: string | null) {
    if (!fechaSolicitud) {
      return null;
    }

    const rows = await this.executeEvaluateList<{ id: number | null }>({
      buildCmd: () =>
        `[CUIT]=${cuit} AND [FechaAlta]<=#${fechaSolicitud}#`,
      fields: TITULAR_NUEVO_FIELDS,
      mapRow: (row) => ({
        id: getNumberValue(row, titularNuevoFieldIndex, "ID"),
      }),
      tipo: "F.Module.SocioMutual",
    });

    return rows.length === 0;
  }

  private async getSaldoPrestamosVigentes(cuit: string) {
    const rows = await this.executeEvaluateList<number | null>({
      buildCmd: () => `[SocioTitular.Socio.CUIT]=${cuit}`,
      fields: SALDO_PRESTAMOS_FIELDS,
      mapRow: (row) =>
        getNumberValue(row, saldoPrestamosFieldIndex, "DeudaTotal"),
      tipo: "F.Module.Cuentas.Prestamos.Prestamo",
    });

    return sumNullableNumbers(rows);
  }

  private async getCompromisoMensualVigente(cuit: string) {
    const { from, to } = buildNextMonthRange();

    const rows = await this.executeEvaluateList<number | null>({
      buildCmd: () =>
        `[Fecha]>=#${from}# AND [Fecha]<=#${to}# AND [FechaCobro] Is Null AND [Prestamo.SocioTitular.Socio.CUIT]=${cuit}`,
      fields: COMPROMISO_MENSUAL_FIELDS,
      mapRow: (row) =>
        getNumberValue(row, compromisoMensualFieldIndex, "MontoTotal"),
      tipo: "F.Module.Cuentas.Prestamos.CuotaPrestamo",
    });

    return sumNullableNumbers(rows);
  }

  private async executeEvaluateList<TResult>(
    definition: EvaluateListDefinition<TResult>,
  ): Promise<TResult[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(this.buildEvaluateListUrl(), {
        body: JSON.stringify({
          campos: definition.fields.join(";"),
          cmd: definition.buildCmd(),
          max: 200,
          tipo: definition.tipo,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new CalculadoraMutualLegacyUnavailableError();
      }

      const responseBody = await response.json();

      if (!Array.isArray(responseBody)) {
        throw new CalculadoraMutualLegacyUnavailableError();
      }

      return responseBody
        .filter((row): row is EvaluateRow => Array.isArray(row))
        .map((row) => definition.mapRow(row));
    } catch (error) {
      if (
        error instanceof CalculadoraMutualLegacyUnavailableError ||
        error instanceof SolicitudNotFoundError
      ) {
        throw error;
      }

      throw new CalculadoraMutualLegacyUnavailableError();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildEvaluateListUrl() {
    return new URL("/api/Empresa/EvaluateList", this.baseUrl).toString();
  }
}

function buildFieldIndexByName(fields: readonly string[]) {
  return fields.reduce<Record<string, number>>((accumulator, field, index) => {
    accumulator[field] = index;
    return accumulator;
  }, {});
}

function getRowValue(
  row: EvaluateRow,
  fieldIndexByName: Record<string, number>,
  fieldName: string,
): EvaluatePrimitive {
  const index = fieldIndexByName[fieldName];

  if (index === undefined) {
    return null;
  }

  return row[index] ?? null;
}

function getStringValue(
  row: EvaluateRow,
  fieldIndexByName: Record<string, number>,
  fieldName: string,
) {
  const value = getRowValue(row, fieldIndexByName, fieldName);

  if (typeof value === "string") {
    return value;
  }

  if (value === null) {
    return null;
  }

  return String(value);
}

function getNumberValue(
  row: EvaluateRow,
  fieldIndexByName: Record<string, number>,
  fieldName: string,
) {
  const value = getRowValue(row, fieldIndexByName, fieldName);

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numericValue = Number(value);
    return Number.isNaN(numericValue) ? null : numericValue;
  }

  return null;
}

function formatApiDate(value: string | null) {
  if (!value) {
    return null;
  }

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : value;
}

function resolveSettled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function sumNullableNumbers(values: (number | null)[]) {
  const nonNullValues = values.filter(
    (value): value is number => value !== null,
  );

  if (nonNullValues.length === 0) {
    return 0;
  }

  return nonNullValues.reduce((total, value) => total + value, 0);
}

function buildCmdDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildNextMonthRange(referenceDate = new Date()) {
  const from = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1,
    1,
  );
  const to = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 2, 0);

  return {
    from: buildCmdDate(from),
    to: buildCmdDate(to),
  };
}

function mapSolicitudSnapshotRow(row: EvaluateRow): CalculadoraMutualSolicitudSnapshot {
  return {
    antiguedadLaboral: getNumberValue(
      row,
      solicitudSnapshotFieldIndex,
      "Antiguedad",
    ),
    convenio: getStringValue(
      row,
      solicitudSnapshotFieldIndex,
      "LineaPrestamo.[Terminos y condiciones].Descripcion",
    ),
    cuitTitular: getStringValue(row, solicitudSnapshotFieldIndex, "CUIT"),
    cuotaResultante: getNumberValue(
      row,
      solicitudSnapshotFieldIndex,
      "CuotaResultante",
    ),
    cuotas: getNumberValue(row, solicitudSnapshotFieldIndex, "Cuotas"),
    cupoDisponibleVendedor: getNumberValue(
      row,
      solicitudSnapshotFieldIndex,
      "CupoTitular",
    ),
    dniTitular: getStringValue(
      row,
      solicitudSnapshotFieldIndex,
      "NroDocumento",
    ),
    fechaPrimerVencimiento: formatApiDate(
      getStringValue(
        row,
        solicitudSnapshotFieldIndex,
        "FechaPrimerVencimiento",
      ),
    ),
    fechaSolicitud: formatApiDate(
      getStringValue(row, solicitudSnapshotFieldIndex, "Fecha"),
    ),
    ingresos: getNumberValue(
      row,
      solicitudSnapshotFieldIndex,
      "MontoRecibo",
    ),
    lineaDescripcion: getStringValue(
      row,
      solicitudSnapshotFieldIndex,
      "LineaPrestamo.Descripcion",
    ),
    lineaId: getNumberValue(
      row,
      solicitudSnapshotFieldIndex,
      "LineaPrestamo.ID",
    ),
    montoAFinanciar: getNumberValue(
      row,
      solicitudSnapshotFieldIndex,
      "MontoAFinanciar",
    ),
    nombreCompletoTitular: getStringValue(
      row,
      solicitudSnapshotFieldIndex,
      "NombreCompleto",
    ),
    nroSolicitud: getStringValue(
      row,
      solicitudSnapshotFieldIndex,
      "NroSolicitud",
    ),
    vendedor: getStringValue(
      row,
      solicitudSnapshotFieldIndex,
      "VendedorSolicitud.Nombre",
    ),
  };
}

function mapSocioIndicadoresRow(row: EvaluateRow) {
  const rechazos = getNumberValue(
    row,
    socioIndicadoresFieldIndex,
    "[Rechazos en el Mes]",
  );
  const situacion = getStringValue(
    row,
    socioIndicadoresFieldIndex,
    "[Renovaciones Final]",
  );

  return {
    rechazosDelMes: rechazos,
    situacionSocio: situacion && situacion.trim() !== "" ? situacion : "SIN DATOS",
  };
}
