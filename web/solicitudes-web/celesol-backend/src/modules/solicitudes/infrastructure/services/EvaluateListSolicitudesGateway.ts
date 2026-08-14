import { LegacySolicitudesUnavailableError } from "../../domain/solicitudes-errors";
import type { SolicitudesLegacyGateway } from "../../domain/services/SolicitudesLegacyGateway";
import type {
  LineaPrestamoPresolicitud,
  PrestamoOtorgadoLegacy,
  SocioMutualCancelacionDetalle,
  SocioMutualCancelacionListItem,
  SocioMutualLegacy,
  SolicitudDetalleLegacy,
  SolicitudDetail,
  SolicitudPrecargaItem,
  SolicitudRecienteItem,
} from "../../domain/entities/Solicitud.entity";

type EvaluateListPrimitive = boolean | null | number | string;
type EvaluateListRow = EvaluateListPrimitive[];

type EvaluateListRequest = {
  campos: string;
  cmd: string;
  max: number;
  tipo: string;
};

type EvaluateListDefinition<TResult> = {
  buildCmd: () => string;
  defaultMax: number;
  fields: readonly string[];
  mapRow: (row: EvaluateListRow) => TResult;
  tipo: string;
};

// EvaluateObj es el equivalente a EvaluateList para un unico objeto: mismo
// "cmd"/"tipo"/"campos", sin "max". La fila devuelta usa la misma convencion
// posicional que EvaluateList (cada campo, incluidos los anidados tipo
// "CuentaBancariaHabitual.CBU", es una sola columna en esa posicion).
type EvaluateObjRequest = {
  campos: string;
  cmd: string;
  tipo: string;
};

type EvaluateObjDefinition<TResult> = {
  buildCmd: () => string;
  fields: readonly string[];
  mapRow: (row: EvaluateListRow) => TResult;
  tipo: string;
};

type EvaluateListSolicitudesGatewayConfig = {
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

export const SOLICITUDES_PRECARGA_DEFAULT_MAX = 100;
export const SOLICITUDES_RECIENTES_DEFAULT_MAX = 100;
export const SOLICITUDES_HISTORICAS_DEFAULT_MAX = 90000;

export const SOLICITUDES_MAX_LIMIT = 90000;

const SOLICITUDES_PRECARGA_FIELDS = [
  "Oid",
  "NroSolicitud",
  "NroDocumento",
  "VendedorSolicitud.Nombre",
  "Fecha",
  "NombreCompleto",
  "LineaPrestamo.Descripcion",
  "MontoAFinanciar",
  "Cuotas",
  "CuotaResultante",
  "Estado.Descripcion",
  "UltimaNovedad.Texto",
] as const;

const SOLICITUDES_RECIENTES_FIELDS = [...SOLICITUDES_PRECARGA_FIELDS] as const;
const SOLICITUDES_HISTORICAS_FIELDS = [...SOLICITUDES_PRECARGA_FIELDS] as const;

const SOLICITUD_DETALLE_FIELDS = [
  "Oid",
  "NroDocumento",
  "LineaPrestamo.Descripcion",
  "MontoAFinanciar",
  "Motivo",
  "NroSolicitud",
  "Estado.Descripcion",
  "UltimaNovedad.Texto",
  "NroOperacion",
  "VendedorSolicitud.Nombre",
  "FechaPrimerVencimiento",
] as const;

const SOCIO_MUTUAL_FIELDS = [
  "TipoDoc.Descripcion",
  "NroDoc",
  "CUIT",
  "Apellido",
  "Nombre",
  "FechaDeNacimiento",
  "Domicilio.Calle",
  "Domicilio.NroPuerta",
  "Domicilio.Localidad.Nombre",
  "Celular",
  "Telefono",
  "Email",
  "CuentaBancariaHabitual.CBU",
  "NroSocio",
  "PEP",
  "Nacionalidad",
  "Sexo",
  "EstadoCivil",
] as const;

const SOCIO_MUTUAL_CANCELACIONES_LIST_FIELDS = [
  "ID",
  "NroSocio",
  "NombreCompleto",
  "CUIT",
  "NroDoc",
  "DadoDeBaja",
  "CategoriaActual.Nombre",
] as const;

const SOCIO_MUTUAL_CANCELACION_DETALLE_FIELDS = [
  "ID",
  "NroSocio",
  "Nombre",
  "Apellido",
  "NombreCompleto",
  "NroDoc",
  "CUIT",
  "FechaDeNacimiento",
  "Sexo",
  "EstadoCivil",
  "Telefono",
  "Celular",
  "WhatsApp",
  "Email",
  "CategoriaActual.ID",
  "CategoriaActual.Nombre",
  "CategoriaFT.ID",
  "CategoriaFT.Nombre",
  "DadoDeBaja",
  "ClasificacionPEP",
  "PEP",
  "PEPExterno",
  "SujetoObligado",
  "VinculoPEP",
  "Saldo",
  "CuentaBancariaHabitual.Nombre",
  "CuentaBancariaHabitual.CBU",
  "CuentaBancariaHabitual.NroCuenta",
  "CuentaBancariaHabitual.SucursalBanco",
  "CuentaDebitoCtaSocial",
] as const;

// Relacion anidada Prestamo desde PreSolicitud.Module.Solicitud. Solo existe
// cuando el prestamo tiene una PreSolicitud digital asociada con el mismo
// Oid -- prestamos cargados directo en Vimax (sin flujo de solicitud digital)
// no aparecen por esta via, ver PRESTAMO_DIRECTO_FIELDS mas abajo.
const PRESTAMO_OTORGADO_FIELDS = [
  "Prestamo.NroCuenta",
  "Prestamo.Capital",
  "Prestamo.MontoPrestamo",
  "Prestamo.FechaEmision",
  "Prestamo.PrimerVencimiento",
  "Prestamo.Vencimiento",
  "Prestamo.TEM",
  "Prestamo.TNA",
  "Prestamo.TEA",
  "Prestamo.CFT",
] as const;

// Fallback para prestamos legacy sin PreSolicitud digital asociada: se
// consulta F.Module.Cuentas.Prestamos.Prestamo directo por su propio ID, que
// es el mismo valor que guardamos como legacyOid (confirmado contra la API
// real -- ver conversacion sobre GetFinSolicitudDatos).
const PRESTAMO_DIRECTO_FIELDS = [
  "NroCuenta",
  "Capital",
  "MontoPrestamo",
  "FechaEmision",
  "PrimerVencimiento",
  "Vencimiento",
  "TEM",
  "TNA",
  "TEA",
  "CFT",
] as const;

const LINEAS_PRESTAMO_PRESOLICITUD_FIELDS = [
  "Oid",
  "Vigente",
  "Descripcion",
  "CantidadMinimaCuotas",
  "CantidadMaximaCuotas",
  "MontoMaximo",
  "MontoMinimo",
  "Tasa",
] as const;

const SOLICITUD_DETAIL_FIELDS = [
  "TipoDocumento.Descripcion",
  "NroDocumento",
  "CUIT",
  "Apellido",
  "Nombre",
  "FechaDeNacimiento",
  "Calle",
  "NroPuerta",
  "Localidad.ClaveBusqueda",
  "Celular",
  "Telefono",
  "Email",
  "MontoRecibo",
  "FechaIngresoLaboral",
  "CBU",
  "NroSocio",
  "PEP",
  "TYCAceptado",
  "Nacionalidad",
  "Sexo",
  "EstadoCivil",
  "Observaciones",
  "Cuotas",
  "Motivo",
  "NroSolicitud",
  "Estado.Descripcion",
  "UltimaNovedad.Texto",
  "CupoTitular",
  "MontoAFinanciar",
  "MontoMaximoAFinanciar",
  "MontoMaximoCuota",
  "CuotaResultante",
  "FechaUltimaCuota",
  "NroOperacion",
  "EjecutivoSolicitud.Nombre",
  "VendedorSolicitud.Nombre",
  "FirmaDigitalmente",
  "ApellidoConyuge",
  "TipoDocumentoConyuge.Descripcion",
  "NroDocumentoConyuge",
  "SexoConyuge",
  "FechaNacimimentoConyuge", // este error de tipeo es real en el campo de legacy, no corregir
  "ActividadConyuge",
  "IngresosMensualesConyuge",
  "NacionalidadConyuge",
  "Empleador",
  "RelacionLaboral",
  "DescuentosSueldo",
  "Tarjetas",
  "Vehiculo",
  "Vivienda",
  "PisoDepto",
  "DomicilioLaboral.Calle",
  "DomicilioLaboral.NroPuerta",
  "DomicilioLaboral.Localidad.ClaveBusqueda",
  "Antiguedad",
  "LineaPrestamo.Descripcion",
  "FechaPrimerVencimiento",
] as const;
const LEGACY_USER_FIELDS = ["ID"] as const;
const VENDEDOR_SOLICITUD_FIELDS = ["Agente.Nombre"] as const;
const VENDEDOR_HISTORIAL_FIELDS = ["Oid", "VendedorSolicitud.ID"] as const;

const solicitudesPrecargaFieldIndex = buildFieldIndexByName(
  SOLICITUDES_PRECARGA_FIELDS,
);
const solicitudesRecientesFieldIndex = buildFieldIndexByName(
  SOLICITUDES_RECIENTES_FIELDS,
);
const solicitudesHistoricasFieldIndex = buildFieldIndexByName(
  SOLICITUDES_HISTORICAS_FIELDS,
);
const solicitudDetalleFieldIndex = buildFieldIndexByName(
  SOLICITUD_DETALLE_FIELDS,
);
const socioMutualFieldIndex = buildFieldIndexByName(SOCIO_MUTUAL_FIELDS);
const socioMutualCancelacionesListFieldIndex = buildFieldIndexByName(
  SOCIO_MUTUAL_CANCELACIONES_LIST_FIELDS,
);
const socioMutualCancelacionDetalleFieldIndex = buildFieldIndexByName(
  SOCIO_MUTUAL_CANCELACION_DETALLE_FIELDS,
);
const lineasPrestamoFieldIndex = buildFieldIndexByName(
  LINEAS_PRESTAMO_PRESOLICITUD_FIELDS,
);
const prestamoOtorgadoFieldIndex = buildFieldIndexByName(
  PRESTAMO_OTORGADO_FIELDS,
);
const prestamoDirectoFieldIndex = buildFieldIndexByName(
  PRESTAMO_DIRECTO_FIELDS,
);
const solicitudDetailFieldIndex = buildFieldIndexByName(SOLICITUD_DETAIL_FIELDS);
const legacyUserFieldIndex = buildFieldIndexByName(LEGACY_USER_FIELDS);
const vendedorSolicitudFieldIndex = buildFieldIndexByName(
  VENDEDOR_SOLICITUD_FIELDS,
);
const vendedorHistorialFieldIndex = buildFieldIndexByName(
  VENDEDOR_HISTORIAL_FIELDS,
);

export class EvaluateListSolicitudesGateway implements SolicitudesLegacyGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(
    config: EvaluateListSolicitudesGatewayConfig,
    fetcher: Fetcher = fetch,
  ) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  getDetalleByNroSolicitud(nroSolicitud: string) {
    return this.executeEvaluateList(
      buildSolicitudDetalleDefinitionByNroSolicitud(nroSolicitud),
      1,
    );
  }

  getDetailByOid(oid: string) {
    return this.executeEvaluateList(buildSolicitudDetailDefinitionByOid(oid), 1);
  }

  getHistoricas(legacyUser: string, max: number) {
    return this.executeEvaluateList(
      buildSolicitudesHistoricasDefinition(legacyUser),
      max,
    );
  }

  async getLegacyUserId(legacyUser: string): Promise<number | null> {
    const legacyUserRows = await this.executeEvaluateList(
      buildLegacyUserByUserNameDefinition(legacyUser),
      1,
    );

    return legacyUserRows[0]?.id ?? null;
  }

  // Un mismo login puede tener mas de un VendedorSolicitud asociado
  // (duplicados/perfiles renombrados a lo largo del tiempo), sin un campo
  // confiable en el catalogo VendedorSolicitud -- ni "Activo", ni fecha --
  // para distinguir cual es el vigente. En cambio, el historial real de
  // solicitudes de ese login si lo revela: se toma el VendedorSolicitud.ID
  // de la solicitud propia mas reciente (mayor Oid). Confirmado contra
  // datos reales que esto le gana a "elegir el ID mas alto del catalogo"
  // (que en un caso real eligio un perfil viejo en desuso) -- ver seccion
  // 14 del design doc.
  async getVendedorLegacyId(legacyUser: string): Promise<number | null> {
    const rows = await this.executeEvaluateList(
      buildSolicitudesByVendedorUserNameDefinition(legacyUser),
      500,
    );
    let mostRecent: { oid: number; vendedorId: number } | null = null;

    for (const row of rows) {
      if (row.oid === null || row.vendedorId === null) {
        continue;
      }

      if (!mostRecent || row.oid > mostRecent.oid) {
        mostRecent = { oid: row.oid, vendedorId: row.vendedorId };
      }
    }

    return mostRecent?.vendedorId ?? null;
  }

  async getLineasPrestamoByLegacyUser(legacyUser: string) {
    const legacyUserId = await this.getLegacyUserId(legacyUser);

    if (legacyUserId === null || legacyUserId === undefined) {
      return [];
    }

    const vendedorRows = await this.executeEvaluateList(
      buildVendedorSolicitudByUsuarioIdDefinition(legacyUserId),
      1,
    );
    const agenteNombre = vendedorRows[0]?.agenteNombre?.trim();

    if (!agenteNombre) {
      return [];
    }

    return this.executeEvaluateList(
      buildLineasPrestamoDefinitionByAgente(agenteNombre),
      2000,
    );
  }

  getPrecarga(legacyUser: string, max: number) {
    return this.executeEvaluateList(
      buildSolicitudesPrecargaDefinition(legacyUser),
      max,
    );
  }

  getRecientes(legacyUser: string, max: number) {
    return this.executeEvaluateList(
      buildSolicitudesRecientesDefinition(legacyUser),
      max,
    );
  }

  getSocioByDni(dni: string) {
    return this.executeEvaluateList(buildSocioMutualDefinitionByDni(dni), 2);
  }

  async getPrestamoOtorgadoByLegacyOid(legacyOid: string) {
    const prestamo = await this.executeEvaluateObj(
      buildPrestamoOtorgadoDefinitionByOid(legacyOid),
    );

    if (prestamo) {
      return prestamo;
    }

    // Sin PreSolicitud digital asociada (prestamos cargados directo en
    // Vimax): buscar el Prestamo directo por su propio ID.
    return this.executeEvaluateObj(
      buildPrestamoDirectoDefinitionByOid(legacyOid),
    );
  }

  getSocioMutualCancelacionDetalleById(id: string) {
    return this.executeEvaluateObj(
      buildSocioMutualCancelacionDetalleDefinition(id),
    );
  }

  listSociosCancelaciones() {
    return this.executeEvaluateList(
      buildSocioMutualCancelacionesDefinition(),
      100,
    );
  }

  private async executeEvaluateObj<TResult>(
    definition: EvaluateObjDefinition<TResult>,
  ): Promise<TResult | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(this.buildEvaluateObjUrl(), {
        body: JSON.stringify(buildEvaluateObjRequest(definition)),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok) {
        if (await isLegacyObjectNotFoundResponse(response)) {
          return null;
        }

        throw new LegacySolicitudesUnavailableError();
      }

      const responseBody = await response.json();
      const row = extractEvaluateObjRow(responseBody);

      if (!row) {
        return null;
      }

      return definition.mapRow(row);
    } catch (error) {
      if (error instanceof LegacySolicitudesUnavailableError) {
        throw error;
      }

      throw new LegacySolicitudesUnavailableError();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async executeEvaluateList<TResult>(
    definition: EvaluateListDefinition<TResult>,
    max = definition.defaultMax,
  ): Promise<TResult[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(this.buildEvaluateListUrl(), {
        body: JSON.stringify(buildEvaluateListRequest(definition, max)),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new LegacySolicitudesUnavailableError();
      }

      const responseBody = await response.json();

      if (!Array.isArray(responseBody)) {
        throw new LegacySolicitudesUnavailableError();
      }

      return responseBody
        .filter((row): row is EvaluateListRow => Array.isArray(row))
        .map((row) => definition.mapRow(row));
    } catch (error) {
      if (error instanceof LegacySolicitudesUnavailableError) {
        throw error;
      }

      throw new LegacySolicitudesUnavailableError();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildEvaluateListUrl() {
    return new URL("/api/Empresa/EvaluateList", this.baseUrl).toString();
  }

  private buildEvaluateObjUrl() {
    return new URL("/api/Empresa/EvaluateObj", this.baseUrl).toString();
  }
}

export function buildEvaluateListRequest<TResult>(
  definition: EvaluateListDefinition<TResult>,
  max = definition.defaultMax,
): EvaluateListRequest {
  return {
    campos: definition.fields.join(";"),
    cmd: definition.buildCmd(),
    max,
    tipo: definition.tipo,
  };
}

export function buildEvaluateObjRequest<TResult>(
  definition: EvaluateObjDefinition<TResult>,
): EvaluateObjRequest {
  return {
    campos: definition.fields.join(";"),
    cmd: definition.buildCmd(),
    tipo: definition.tipo,
  };
}

// Vimax responde EvaluateObj con HTTP 500 (no 200 + vacio) cuando el cmd no
// matchea ningun objeto -- confirmado contra la API real. Sin este chequeo,
// un "no encontrado" legitimo del legado se confundia con una caida real del
// servicio (LegacySolicitudesUnavailableError).
async function isLegacyObjectNotFoundResponse(response: {
  json(): Promise<unknown>;
}): Promise<boolean> {
  const body = await response.json().catch(() => null);

  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { detail?: unknown }).detail === "string" &&
    (body as { detail: string }).detail.includes(
      "No existe objeto con esas condiciones",
    )
  );
}

// EvaluateObj devuelve un unico objeto (no una lista): la fila puede venir
// como un array de primitivos directamente, o -por si el legado la envuelve
// igual que EvaluateList- como un array de un solo array. Se acepta cualquiera
// de las dos formas; cualquier otra respuesta se trata como "no encontrado".
export function extractEvaluateObjRow(
  responseBody: unknown,
): EvaluateListRow | null {
  if (!Array.isArray(responseBody) || responseBody.length === 0) {
    return null;
  }

  if (responseBody.every((value) => !Array.isArray(value))) {
    return responseBody as EvaluateListRow;
  }

  const [firstRow] = responseBody;

  return Array.isArray(firstRow) ? firstRow : null;
}

export function buildSolicitudesPrecargaDefinition(
  legacyUser: string,
): EvaluateListDefinition<SolicitudPrecargaItem> {
  const escapedLegacyUser = escapeLegacyString(legacyUser);

  return {
    buildCmd: () =>
      `(Creado.Usuario.UserName = '${escapedLegacyUser}' or EjecutivoSolicitud.Usuario.UserName = '${escapedLegacyUser}' or VendedorSolicitud.Nombre = '${escapedLegacyUser}') and Estado.Descripcion = 'CargaVendedor'`,
    defaultMax: SOLICITUDES_PRECARGA_DEFAULT_MAX,
    fields: SOLICITUDES_PRECARGA_FIELDS,
    mapRow: mapSolicitudPrecargaRow,
    tipo: "PreSolicitud.Module.Solicitud",
  };
}

export function buildSolicitudesRecientesDefinition(
  legacyUser: string,
): EvaluateListDefinition<SolicitudRecienteItem> {
  const escapedLegacyUser = escapeLegacyString(legacyUser);

  return {
    buildCmd: () =>
      `(Creado.Usuario.UserName = '${escapedLegacyUser}' or EjecutivoSolicitud.Usuario.UserName = '${escapedLegacyUser}' or VendedorSolicitud.Nombre = '${escapedLegacyUser}') and Estado.Descripcion != 'CargaVendedor' and (${buildYearsBackToTodayDateRangeCmd("[Fecha]", 5)})`,
    defaultMax: SOLICITUDES_RECIENTES_DEFAULT_MAX,
    fields: SOLICITUDES_RECIENTES_FIELDS,
    mapRow: mapSolicitudRecienteRow,
    tipo: "PreSolicitud.Module.Solicitud",
  };
}

export function buildSolicitudesHistoricasDefinition(
  legacyUser: string,
): EvaluateListDefinition<SolicitudRecienteItem> {
  const escapedLegacyUser = escapeLegacyString(legacyUser);

  return {
    buildCmd: () =>
      `(Creado.Usuario.UserName = '${escapedLegacyUser}' or EjecutivoSolicitud.Usuario.UserName = '${escapedLegacyUser}' or VendedorSolicitud.Usuario.UserName = '${escapedLegacyUser}') and Estado.Descripcion != 'CargaVendedor' and ((IsOutlookIntervalLastWeek([Fecha]) or IsThisWeek([Fecha])) or Grupo.Nombre = 'HISTORIAL')`,
    defaultMax: SOLICITUDES_HISTORICAS_DEFAULT_MAX,
    fields: SOLICITUDES_HISTORICAS_FIELDS,
    mapRow: mapSolicitudHistoricaRow,
    tipo: "PreSolicitud.Module.Solicitud",
  };
}

export function buildSolicitudDetalleDefinitionByNroSolicitud(
  nroSolicitud: string,
): EvaluateListDefinition<SolicitudDetalleLegacy> {
  const escapedNroSolicitud = escapeLegacyString(nroSolicitud);

  return {
    buildCmd: () => `NroSolicitud = '${escapedNroSolicitud}'`,
    defaultMax: 1,
    fields: SOLICITUD_DETALLE_FIELDS,
    mapRow: mapSolicitudDetalleRow,
    tipo: "PreSolicitud.Module.Solicitud",
  };
}

export function buildSolicitudDetailDefinitionByOid(
  oid: string,
): EvaluateListDefinition<SolicitudDetail> {
  return {
    buildCmd: () => `Oid = ${oid}`,
    defaultMax: 1,
    fields: SOLICITUD_DETAIL_FIELDS,
    mapRow: mapSolicitudDetailRow,
    tipo: "PreSolicitud.Module.Solicitud",
  };
}

export function buildSocioMutualDefinitionByDni(
  dni: string,
): EvaluateListDefinition<SocioMutualLegacy> {
  return {
    buildCmd: () => `NroDoc = ${dni}`,
    defaultMax: 2,
    fields: SOCIO_MUTUAL_FIELDS,
    mapRow: mapSocioMutualRow,
    tipo: "F.Module.SocioMutual",
  };
}

export function buildSocioMutualCancelacionesDefinition(): EvaluateListDefinition<SocioMutualCancelacionListItem> {
  return {
    buildCmd: () => "[CategoriaActual.Nombre]='OTROS (CANCELACIONES)'",
    defaultMax: 100,
    fields: SOCIO_MUTUAL_CANCELACIONES_LIST_FIELDS,
    mapRow: mapSocioMutualCancelacionListRow,
    tipo: "F.Module.SocioMutual",
  };
}

export function buildSocioMutualCancelacionDetalleDefinition(
  id: string,
): EvaluateObjDefinition<SocioMutualCancelacionDetalle> {
  return {
    buildCmd: () => `[ID]=${id}`,
    fields: SOCIO_MUTUAL_CANCELACION_DETALLE_FIELDS,
    mapRow: mapSocioMutualCancelacionDetalleRow,
    tipo: "F.Module.SocioMutual",
  };
}

export function buildPrestamoOtorgadoDefinitionByOid(
  oid: string,
): EvaluateObjDefinition<PrestamoOtorgadoLegacy> {
  return {
    buildCmd: () => `[Oid]=${oid}`,
    fields: PRESTAMO_OTORGADO_FIELDS,
    mapRow: mapPrestamoOtorgadoRow,
    tipo: "PreSolicitud.Module.Solicitud",
  };
}

export function buildPrestamoDirectoDefinitionByOid(
  oid: string,
): EvaluateObjDefinition<PrestamoOtorgadoLegacy> {
  return {
    buildCmd: () => `[ID]=${oid}`,
    fields: PRESTAMO_DIRECTO_FIELDS,
    mapRow: mapPrestamoDirectoRow,
    tipo: "F.Module.Cuentas.Prestamos.Prestamo",
  };
}

export function buildLineasPrestamoDefinitionByAgente(
  agenteNombre: string,
): EvaluateListDefinition<LineaPrestamoPresolicitud> {
  const escapedAgenteNombre = escapeLegacyString(agenteNombre);

  return {
    buildCmd: () => `Agentes[Nombre = '${escapedAgenteNombre}']`,
    defaultMax: 2000,
    fields: LINEAS_PRESTAMO_PRESOLICITUD_FIELDS,
    mapRow: mapLineaPrestamoRow,
    tipo: "PreSolicitud.Module.LineaPrestamoPresolicitud",
  };
}

function buildLegacyUserByUserNameDefinition(
  legacyUser: string,
): EvaluateListDefinition<{ id: number | null }> {
  const escapedLegacyUser = escapeLegacyString(legacyUser);

  return {
    buildCmd: () => `UserName = '${escapedLegacyUser}'`,
    defaultMax: 1,
    fields: LEGACY_USER_FIELDS,
    mapRow: mapLegacyUserIdRow,
    tipo: "ClasesBase.Usuario",
  };
}

function buildSolicitudesByVendedorUserNameDefinition(
  legacyUser: string,
): EvaluateListDefinition<{ oid: number | null; vendedorId: number | null }> {
  const escapedLegacyUser = escapeLegacyString(legacyUser);

  return {
    buildCmd: () => `VendedorSolicitud.Usuario.UserName = '${escapedLegacyUser}'`,
    defaultMax: 500,
    fields: VENDEDOR_HISTORIAL_FIELDS,
    mapRow: mapSolicitudVendedorHistorialRow,
    tipo: "PreSolicitud.Module.Solicitud",
  };
}

function buildVendedorSolicitudByUsuarioIdDefinition(
  usuarioId: number,
): EvaluateListDefinition<{ agenteNombre: string | null }> {
  return {
    buildCmd: () => `Usuario.ID = '${usuarioId}'`,
    defaultMax: 1,
    fields: VENDEDOR_SOLICITUD_FIELDS,
    mapRow: mapVendedorSolicitudAgenteRow,
    tipo: "PreSolicitud.Module.VendedorSolicitud",
  };
}

function buildFieldIndexByName(fields: readonly string[]) {
  return fields.reduce<Record<string, number>>((accumulator, field, index) => {
    accumulator[field] = index;
    return accumulator;
  }, {});
}

function getRowValue(
  row: EvaluateListRow,
  fieldIndexByName: Record<string, number>,
  fieldName: string,
): EvaluateListPrimitive {
  const index = fieldIndexByName[fieldName];

  if (index === undefined) {
    return null;
  }

  return row[index] ?? null;
}

function getStringValue(
  row: EvaluateListRow,
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
  row: EvaluateListRow,
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

function getBooleanValue(
  row: EvaluateListRow,
  fieldIndexByName: Record<string, number>,
  fieldName: string,
) {
  const value = getRowValue(row, fieldIndexByName, fieldName);

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === "true" || normalizedValue === "1") {
      return true;
    }

    if (normalizedValue === "false" || normalizedValue === "0") {
      return false;
    }
  }

  return null;
}

function getNullableNumberValue(
  row: EvaluateListRow,
  fieldIndexByName: Record<string, number>,
  fieldName: string,
) {
  return getNumberValue(row, fieldIndexByName, fieldName);
}

function formatApiDate(value: string | null) {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

  if (!match) {
    return value;
  }

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function formatCmdDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildYearsBackToTodayDateRangeCmd(
  fieldName: string,
  yearsBack: number,
) {
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setFullYear(today.getFullYear() - yearsBack);

  const from = formatCmdDate(fromDate);
  const to = formatCmdDate(today);

  return `${fieldName} >= '${from}' and ${fieldName} <= '${to}'`;
}

function escapeLegacyString(value: string) {
  return value.replaceAll("'", "''");
}

function mapSolicitudPrecargaRow(row: EvaluateListRow): SolicitudPrecargaItem {
  return {
    cuotas: getNumberValue(row, solicitudesPrecargaFieldIndex, "Cuotas"),
    cuotaResultante: getStringValue(
      row,
      solicitudesPrecargaFieldIndex,
      "CuotaResultante",
    ),
    estado: getStringValue(
      row,
      solicitudesPrecargaFieldIndex,
      "Estado.Descripcion",
    ),
    fecha: formatApiDate(
      getStringValue(row, solicitudesPrecargaFieldIndex, "Fecha"),
    ),
    id: [
      getStringValue(
        row,
        solicitudesPrecargaFieldIndex,
        "VendedorSolicitud.Nombre",
      ),
      getStringValue(row, solicitudesPrecargaFieldIndex, "Fecha"),
      getStringValue(row, solicitudesPrecargaFieldIndex, "NombreCompleto"),
    ]
      .filter((value) => value && value.trim() !== "")
      .join("|"),
    lineaPrestamo: getStringValue(
      row,
      solicitudesPrecargaFieldIndex,
      "LineaPrestamo.Descripcion",
    ),
    montoAFinanciar: getNumberValue(
      row,
      solicitudesPrecargaFieldIndex,
      "MontoAFinanciar",
    ),
    nombreCompleto: getStringValue(
      row,
      solicitudesPrecargaFieldIndex,
      "NombreCompleto",
    ),
    nroDocumento: getStringValue(
      row,
      solicitudesPrecargaFieldIndex,
      "NroDocumento",
    ),
    nroSolicitud: getStringValue(
      row,
      solicitudesPrecargaFieldIndex,
      "NroSolicitud",
    ),
    oid: getStringValue(row, solicitudesPrecargaFieldIndex, "Oid"),
    ultimaNovedad: getStringValue(
      row,
      solicitudesPrecargaFieldIndex,
      "UltimaNovedad.Texto",
    ),
    vendedorSolicitud: getStringValue(
      row,
      solicitudesPrecargaFieldIndex,
      "VendedorSolicitud.Nombre",
    ),
  };
}

function mapSolicitudRecienteRow(row: EvaluateListRow): SolicitudRecienteItem {
  return {
    cuotas: getNumberValue(row, solicitudesRecientesFieldIndex, "Cuotas"),
    cuotaResultante: getStringValue(
      row, solicitudesRecientesFieldIndex, "CuotaResultante"
    ),
    estado: getStringValue(
      row,
      solicitudesRecientesFieldIndex,
      "Estado.Descripcion",
    ),
    fecha: formatApiDate(
      getStringValue(row, solicitudesRecientesFieldIndex, "Fecha"),
    ),
    id: [
      getStringValue(
        row,
        solicitudesRecientesFieldIndex,
        "VendedorSolicitud.Nombre",
      ),
      getStringValue(row, solicitudesRecientesFieldIndex, "Fecha"),
      getStringValue(row, solicitudesRecientesFieldIndex, "NombreCompleto"),
    ]
      .filter((value) => value && value.trim() !== "")
      .join("|"),
    lineaPrestamo: getStringValue(
      row,
      solicitudesRecientesFieldIndex,
      "LineaPrestamo.Descripcion",
    ),
    montoAFinanciar: getNumberValue(
      row,
      solicitudesRecientesFieldIndex,
      "MontoAFinanciar",
    ),
    nombreCompleto: getStringValue(
      row,
      solicitudesRecientesFieldIndex,
      "NombreCompleto",
    ),
    nroDocumento: getStringValue(
      row,
      solicitudesRecientesFieldIndex,
      "NroDocumento",
    ),
    nroSolicitud: getStringValue(
      row,
      solicitudesRecientesFieldIndex,
      "NroSolicitud",
    ),
    oid: getStringValue(row, solicitudesRecientesFieldIndex, "Oid"),
    ultimaNovedad: getStringValue(
      row,
      solicitudesRecientesFieldIndex,
      "UltimaNovedad.Texto",
    ),
    vendedorSolicitud: getStringValue(
      row,
      solicitudesRecientesFieldIndex,
      "VendedorSolicitud.Nombre",
    ),
  };
}

function mapSolicitudHistoricaRow(row: EvaluateListRow): SolicitudRecienteItem {
  return {
    cuotas: getNumberValue(row, solicitudesHistoricasFieldIndex, "Cuotas"),
    cuotaResultante: getStringValue(
      row,
      solicitudesHistoricasFieldIndex,
      "CuotaResultante",
    ),
    estado: getStringValue(
      row,
      solicitudesHistoricasFieldIndex,
      "Estado.Descripcion",
    ),
    fecha: formatApiDate(
      getStringValue(row, solicitudesHistoricasFieldIndex, "Fecha"),
    ),
    id: [
      getStringValue(
        row,
        solicitudesHistoricasFieldIndex,
        "VendedorSolicitud.Nombre",
      ),
      getStringValue(row, solicitudesHistoricasFieldIndex, "Fecha"),
      getStringValue(row, solicitudesHistoricasFieldIndex, "NombreCompleto"),
    ]
      .filter((value) => value && value.trim() !== "")
      .join("|"),
    lineaPrestamo: getStringValue(
      row,
      solicitudesHistoricasFieldIndex,
      "LineaPrestamo.Descripcion",
    ),
    montoAFinanciar: getNumberValue(
      row,
      solicitudesHistoricasFieldIndex,
      "MontoAFinanciar",
    ),
    nombreCompleto: getStringValue(
      row,
      solicitudesHistoricasFieldIndex,
      "NombreCompleto",
    ),
    nroDocumento: getStringValue(
      row,
      solicitudesHistoricasFieldIndex,
      "NroDocumento",
    ),
    nroSolicitud: getStringValue(
      row,
      solicitudesHistoricasFieldIndex,
      "NroSolicitud",
    ),
    oid: getStringValue(row, solicitudesHistoricasFieldIndex, "Oid"),
    ultimaNovedad: getStringValue(
      row,
      solicitudesHistoricasFieldIndex,
      "UltimaNovedad.Texto",
    ),
    vendedorSolicitud: getStringValue(
      row,
      solicitudesHistoricasFieldIndex,
      "VendedorSolicitud.Nombre",
    ),
  };
}

function mapSolicitudDetalleRow(row: EvaluateListRow): SolicitudDetalleLegacy {
  return {
    estado: getStringValue(
      row,
      solicitudDetalleFieldIndex,
      "Estado.Descripcion",
    ),
    fechaPrimerVencimiento: formatApiDate(
      getStringValue(row, solicitudDetalleFieldIndex, "FechaPrimerVencimiento"),
    ),
    linea: getStringValue(
      row,
      solicitudDetalleFieldIndex,
      "LineaPrestamo.Descripcion",
    ),
    montoAFinanciar: getNumberValue(
      row,
      solicitudDetalleFieldIndex,
      "MontoAFinanciar",
    ),
    motivo: getStringValue(row, solicitudDetalleFieldIndex, "Motivo"),
    noInterno: null,
    nioOperacion: getStringValue(
      row,
      solicitudDetalleFieldIndex,
      "NroOperacion",
    ),
    noSolicitud: getStringValue(
      row,
      solicitudDetalleFieldIndex,
      "NroSolicitud",
    ),
    ultimaNovedad: getStringValue(
      row,
      solicitudDetalleFieldIndex,
      "UltimaNovedad.Texto",
    ),
    vendedorSolicitud: getStringValue(
      row,
      solicitudDetalleFieldIndex,
      "VendedorSolicitud.Nombre",
    ),
  };
}

function mapSolicitudDetailRow(row: EvaluateListRow): SolicitudDetail {
  const observaciones = getStringValue(
    row,
    solicitudDetailFieldIndex,
    "Observaciones",
  );
  const fechaIngresoLaboral = formatApiDate(
    getStringValue(row, solicitudDetailFieldIndex, "FechaIngresoLaboral"),
  );
  const montoRecibo = getNullableNumberValue(
    row,
    solicitudDetailFieldIndex,
    "MontoRecibo",
  );

  return {
    conyuge: {
      actividad: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "ActividadConyuge",
      ),
      apellido: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "ApellidoConyuge",
      ),
      fechaNacimiento: formatApiDate(
        getStringValue(
          row,
          solicitudDetailFieldIndex,
          "FechaNacimimentoConyuge", // este error de tipeo es real en el campo de legacy, no corregir
        ),
      ),
      ingresosMensuales: getNullableNumberValue(
        row,
        solicitudDetailFieldIndex,
        "IngresosMensualesConyuge",
      ),
      nacionalidad: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "NacionalidadConyuge",
      ),
      nroDocumento: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "NroDocumentoConyuge",
      ),
      sexo: getStringValue(row, solicitudDetailFieldIndex, "SexoConyuge"),
      tipoDocumento: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "TipoDocumentoConyuge.Descripcion",
      ),
    },
    economicosLaborales: {
      actividadLaboral: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "RelacionLaboral",
      ),
      antiguedad: getNullableNumberValue(
        row,
        solicitudDetailFieldIndex,
        "Antiguedad",
      ),
      descuentosSueldo: getNullableNumberValue(
        row,
        solicitudDetailFieldIndex,
        "DescuentosSueldo",
      ),
      domicilioLaboralCalle: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "DomicilioLaboral.Calle",
      ),
      domicilioLaboralLocalidad: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "DomicilioLaboral.Localidad.ClaveBusqueda",
      ),
      domicilioLaboralNroPuerta: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "DomicilioLaboral.NroPuerta",
      ),
      empleador: getStringValue(row, solicitudDetailFieldIndex, "Empleador"),
      fechaIngresoLaboral,
      montoRecibo,
      pisoDepto: getStringValue(row, solicitudDetailFieldIndex, "PisoDepto"),
      relacionLaboral: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "RelacionLaboral",
      ),
      tarjetas: getStringValue(row, solicitudDetailFieldIndex, "Tarjetas"),
      vehiculo: getStringValue(row, solicitudDetailFieldIndex, "Vehiculo"),
      vivienda: getStringValue(row, solicitudDetailFieldIndex, "Vivienda"),
    },
    solicitud: {
      cuotaResultante: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "CuotaResultante",
      ),
      cuotas: getNumberValue(row, solicitudDetailFieldIndex, "Cuotas"),
      cupoTitular: getNullableNumberValue(
        row,
        solicitudDetailFieldIndex,
        "CupoTitular",
      ),
      ejecutivoSolicitud: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "EjecutivoSolicitud.Nombre",
      ),
      estado: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "Estado.Descripcion",
      ),
      fechaPrimerVencimiento: formatApiDate(
        getStringValue(
          row,
          solicitudDetailFieldIndex,
          "FechaPrimerVencimiento",
        ),
      ),
      fechaUltimaCuota: formatApiDate(
        getStringValue(row, solicitudDetailFieldIndex, "FechaUltimaCuota"),
      ),
      firmaDigitalmente: getBooleanValue(
        row,
        solicitudDetailFieldIndex,
        "FirmaDigitalmente",
      ),
      lineaPrestamoDescripcion: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "LineaPrestamo.Descripcion",
      ),
      montoAFinanciar: getNumberValue(
        row,
        solicitudDetailFieldIndex,
        "MontoAFinanciar",
      ),
      montoMaximoAFinanciar: getNumberValue(
        row,
        solicitudDetailFieldIndex,
        "MontoMaximoAFinanciar",
      ),
      montoMaximoCuota: getNumberValue(
        row,
        solicitudDetailFieldIndex,
        "MontoMaximoCuota",
      ),
      motivo: getStringValue(row, solicitudDetailFieldIndex, "Motivo"),
      nroInterno: null,
      nroOperacion: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "NroOperacion",
      ),
      nroSolicitud: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "NroSolicitud",
      ),
      observaciones,
      ultimaNovedad: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "UltimaNovedad.Texto",
      ),
      vendedorSolicitud: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "VendedorSolicitud.Nombre",
      ),
    },
    titular: {
      apellido: getStringValue(row, solicitudDetailFieldIndex, "Apellido"),
      cbu: getStringValue(row, solicitudDetailFieldIndex, "CBU"),
      celular: getStringValue(row, solicitudDetailFieldIndex, "Celular"),
      cuit: getStringValue(row, solicitudDetailFieldIndex, "CUIT"),
      domicilioCalle: getStringValue(row, solicitudDetailFieldIndex, "Calle"),
      email: getStringValue(row, solicitudDetailFieldIndex, "Email"),
      estadoCivil: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "EstadoCivil",
      ),
      fechaDeNacimiento: formatApiDate(
        getStringValue(row, solicitudDetailFieldIndex, "FechaDeNacimiento"),
      ),
      fechaIngresoLaboral,
      localidad: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "Localidad.ClaveBusqueda",
      ),
      montoRecibo,
      nacionalidad: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "Nacionalidad",
      ),
      nombre: getStringValue(row, solicitudDetailFieldIndex, "Nombre"),
      nroDocumento: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "NroDocumento",
      ),
      nroPuerta: getStringValue(row, solicitudDetailFieldIndex, "NroPuerta"),
      nroSocio: getStringValue(row, solicitudDetailFieldIndex, "NroSocio"),
      observaciones,
      pep: getStringValue(row, solicitudDetailFieldIndex, "PEP"),
      sexo: getStringValue(row, solicitudDetailFieldIndex, "Sexo"),
      telefono: getStringValue(row, solicitudDetailFieldIndex, "Telefono"),
      tipoDocumento: getStringValue(
        row,
        solicitudDetailFieldIndex,
        "TipoDocumento.Descripcion",
      ),
      tycAceptado: getBooleanValue(
        row,
        solicitudDetailFieldIndex,
        "TYCAceptado",
      ),
    },
  };
}

function mapSocioMutualRow(row: EvaluateListRow): SocioMutualLegacy {
  return {
    apellido: getStringValue(row, socioMutualFieldIndex, "Apellido"),
    cbu: getStringValue(
      row,
      socioMutualFieldIndex,
      "CuentaBancariaHabitual.CBU",
    ),
    celular: getStringValue(row, socioMutualFieldIndex, "Celular"),
    cuit: getStringValue(row, socioMutualFieldIndex, "CUIT"),
    domicilioCalle: getStringValue(
      row,
      socioMutualFieldIndex,
      "Domicilio.Calle",
    ),
    email: getStringValue(row, socioMutualFieldIndex, "Email"),
    estadoCivil: getStringValue(row, socioMutualFieldIndex, "EstadoCivil"),
    fechaDeNacimiento: formatApiDate(
      getStringValue(row, socioMutualFieldIndex, "FechaDeNacimiento"),
    ),
    localidad: getStringValue(
      row,
      socioMutualFieldIndex,
      "Domicilio.Localidad.Nombre",
    ),
    nacionalidad: getStringValue(row, socioMutualFieldIndex, "Nacionalidad"),
    nombre: getStringValue(row, socioMutualFieldIndex, "Nombre"),
    nroDoc: getStringValue(row, socioMutualFieldIndex, "NroDoc"),
    nroPuerta: getStringValue(
      row,
      socioMutualFieldIndex,
      "Domicilio.NroPuerta",
    ),
    nroSocio: getStringValue(row, socioMutualFieldIndex, "NroSocio"),
    pep: getStringValue(row, socioMutualFieldIndex, "PEP"),
    sexo: getStringValue(row, socioMutualFieldIndex, "Sexo"),
    telefono: getStringValue(row, socioMutualFieldIndex, "Telefono"),
    tipoDoc: getStringValue(row, socioMutualFieldIndex, "TipoDoc.Descripcion"),
  };
}

function mapSocioMutualCancelacionListRow(
  row: EvaluateListRow,
): SocioMutualCancelacionListItem {
  return {
    categoriaActualNombre: getStringValue(
      row,
      socioMutualCancelacionesListFieldIndex,
      "CategoriaActual.Nombre",
    ),
    cuit: getStringValue(row, socioMutualCancelacionesListFieldIndex, "CUIT"),
    dadoDeBaja: getBooleanValue(
      row,
      socioMutualCancelacionesListFieldIndex,
      "DadoDeBaja",
    ),
    id: getStringValue(row, socioMutualCancelacionesListFieldIndex, "ID"),
    nombreCompleto: getStringValue(
      row,
      socioMutualCancelacionesListFieldIndex,
      "NombreCompleto",
    ),
    nroDoc: getStringValue(
      row,
      socioMutualCancelacionesListFieldIndex,
      "NroDoc",
    ),
    nroSocio: getStringValue(
      row,
      socioMutualCancelacionesListFieldIndex,
      "NroSocio",
    ),
  };
}

function mapSocioMutualCancelacionDetalleRow(
  row: EvaluateListRow,
): SocioMutualCancelacionDetalle {
  return {
    apellido: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "Apellido",
    ),
    categoriaActualId: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "CategoriaActual.ID",
    ),
    categoriaActualNombre: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "CategoriaActual.Nombre",
    ),
    categoriaFTId: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "CategoriaFT.ID",
    ),
    categoriaFTNombre: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "CategoriaFT.Nombre",
    ),
    celular: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "Celular",
    ),
    clasificacionPEP: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "ClasificacionPEP",
    ),
    cuentaBancariaHabitual: {
      cbu: getStringValue(
        row,
        socioMutualCancelacionDetalleFieldIndex,
        "CuentaBancariaHabitual.CBU",
      ),
      nombre: getStringValue(
        row,
        socioMutualCancelacionDetalleFieldIndex,
        "CuentaBancariaHabitual.Nombre",
      ),
      nroCuenta: getStringValue(
        row,
        socioMutualCancelacionDetalleFieldIndex,
        "CuentaBancariaHabitual.NroCuenta",
      ),
      sucursalBanco: getStringValue(
        row,
        socioMutualCancelacionDetalleFieldIndex,
        "CuentaBancariaHabitual.SucursalBanco",
      ),
    },
    cuentaDebitoCtaSocial: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "CuentaDebitoCtaSocial",
    ),
    cuit: getStringValue(row, socioMutualCancelacionDetalleFieldIndex, "CUIT"),
    dadoDeBaja: getBooleanValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "DadoDeBaja",
    ),
    email: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "Email",
    ),
    estadoCivil: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "EstadoCivil",
    ),
    fechaDeNacimiento: formatApiDate(
      getStringValue(
        row,
        socioMutualCancelacionDetalleFieldIndex,
        "FechaDeNacimiento",
      ),
    ),
    id: getStringValue(row, socioMutualCancelacionDetalleFieldIndex, "ID"),
    nombre: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "Nombre",
    ),
    nombreCompleto: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "NombreCompleto",
    ),
    nroDoc: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "NroDoc",
    ),
    nroSocio: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "NroSocio",
    ),
    pep: getStringValue(row, socioMutualCancelacionDetalleFieldIndex, "PEP"),
    pepExterno: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "PEPExterno",
    ),
    saldo: getNumberValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "Saldo",
    ),
    sexo: getStringValue(row, socioMutualCancelacionDetalleFieldIndex, "Sexo"),
    sujetoObligado: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "SujetoObligado",
    ),
    telefono: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "Telefono",
    ),
    vinculoPEP: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "VinculoPEP",
    ),
    whatsapp: getStringValue(
      row,
      socioMutualCancelacionDetalleFieldIndex,
      "WhatsApp",
    ),
  };
}

function mapPrestamoOtorgadoRow(row: EvaluateListRow): PrestamoOtorgadoLegacy {
  return {
    capital: getNumberValue(row, prestamoOtorgadoFieldIndex, "Prestamo.Capital"),
    cft: getNumberValue(row, prestamoOtorgadoFieldIndex, "Prestamo.CFT"),
    fechaEmision: getStringValue(
      row,
      prestamoOtorgadoFieldIndex,
      "Prestamo.FechaEmision",
    ),
    montoPrestamo: getNumberValue(
      row,
      prestamoOtorgadoFieldIndex,
      "Prestamo.MontoPrestamo",
    ),
    nroCuenta: getStringValue(
      row,
      prestamoOtorgadoFieldIndex,
      "Prestamo.NroCuenta",
    ),
    primerVencimiento: getStringValue(
      row,
      prestamoOtorgadoFieldIndex,
      "Prestamo.PrimerVencimiento",
    ),
    tea: getNumberValue(row, prestamoOtorgadoFieldIndex, "Prestamo.TEA"),
    tem: getNumberValue(row, prestamoOtorgadoFieldIndex, "Prestamo.TEM"),
    tna: getNumberValue(row, prestamoOtorgadoFieldIndex, "Prestamo.TNA"),
    vencimiento: getStringValue(
      row,
      prestamoOtorgadoFieldIndex,
      "Prestamo.Vencimiento",
    ),
  };
}

function mapPrestamoDirectoRow(row: EvaluateListRow): PrestamoOtorgadoLegacy {
  return {
    capital: getNumberValue(row, prestamoDirectoFieldIndex, "Capital"),
    cft: getNumberValue(row, prestamoDirectoFieldIndex, "CFT"),
    fechaEmision: getStringValue(row, prestamoDirectoFieldIndex, "FechaEmision"),
    montoPrestamo: getNumberValue(
      row,
      prestamoDirectoFieldIndex,
      "MontoPrestamo",
    ),
    nroCuenta: getStringValue(row, prestamoDirectoFieldIndex, "NroCuenta"),
    primerVencimiento: getStringValue(
      row,
      prestamoDirectoFieldIndex,
      "PrimerVencimiento",
    ),
    tea: getNumberValue(row, prestamoDirectoFieldIndex, "TEA"),
    tem: getNumberValue(row, prestamoDirectoFieldIndex, "TEM"),
    tna: getNumberValue(row, prestamoDirectoFieldIndex, "TNA"),
    vencimiento: getStringValue(row, prestamoDirectoFieldIndex, "Vencimiento"),
  };
}

function mapLineaPrestamoRow(row: EvaluateListRow): LineaPrestamoPresolicitud {
  return {
    cantidadMaximaCuotas: getNumberValue(
      row,
      lineasPrestamoFieldIndex,
      "CantidadMaximaCuotas",
    ),
    cantidadMinimaCuotas: getNumberValue(
      row,
      lineasPrestamoFieldIndex,
      "CantidadMinimaCuotas",
    ),
    descripcion: getStringValue(row, lineasPrestamoFieldIndex, "Descripcion"),
    montoMaximo: getNumberValue(row, lineasPrestamoFieldIndex, "MontoMaximo"),
    montoMinimo: getNumberValue(row, lineasPrestamoFieldIndex, "MontoMinimo"),
    oid: getStringValue(row, lineasPrestamoFieldIndex, "Oid"),
    tasa: getNumberValue(row, lineasPrestamoFieldIndex, "Tasa"),
    vigente: getBooleanValue(row, lineasPrestamoFieldIndex, "Vigente"),
  };
}

function mapLegacyUserIdRow(row: EvaluateListRow): { id: number | null } {
  return {
    id: getNumberValue(row, legacyUserFieldIndex, "ID"),
  };
}

function mapSolicitudVendedorHistorialRow(
  row: EvaluateListRow,
): { oid: number | null; vendedorId: number | null } {
  return {
    oid: getNumberValue(row, vendedorHistorialFieldIndex, "Oid"),
    vendedorId: getNumberValue(
      row,
      vendedorHistorialFieldIndex,
      "VendedorSolicitud.ID",
    ),
  };
}

function mapVendedorSolicitudAgenteRow(
  row: EvaluateListRow,
): { agenteNombre: string | null } {
  return {
    agenteNombre: getStringValue(
      row,
      vendedorSolicitudFieldIndex,
      "Agente.Nombre",
    ),
  };
}
