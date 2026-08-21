import type {
  SolicitudCore,
  SolicitudCoreConyuge,
  SolicitudCoreDatosLaborales,
  SolicitudCoreGarantia,
  SolicitudCoreState,
  SolicitudCoreTitular,
} from "../entities/SolicitudCore.entity";

export type CreateSolicitudCoreRecord = {
  createdBy: string;
  conyuge: SolicitudCoreConyuge | null;
  cuotaResultante: string | null;
  cuotas: number | null;
  datosLaborales: SolicitudCoreDatosLaborales;
  ejecutivoSolicitud: string | null;
  linkFirmaDigital?: string | null;
  estadoActual: SolicitudCoreState;
  firmaDigitalmente: boolean;
  garantias: SolicitudCoreGarantia[];
  lineaPrestamoDescripcion: string;
  lineaPrestamoLegacyOid: string;
  montoAFinanciar: number | null;
  motivo: string | null;
  observaciones: string | null;
  cupoTitular?: number | null;
  fechaPrimerVencimiento?: string | null;
  nroOperacion?: string | null;
  titular: SolicitudCoreTitular;
  vendedorSolicitud: string | null;
};

export type ListSolicitudesByOwnerInput = {
  createdFrom?: string;
  createdTo?: string;
  excludeEstado?: string;
  estado?: string;
  limit: number;
  nroDocumento?: string;
  offset: number;
  workflowOwnerId?: string;
};

export type ListSolicitudesTrackingInput = {
  createdFrom?: string;
  createdTo?: string;
  excludeEstado?: string;
  estado?: string;
  limit: number;
  nroDocumento?: string;
  offset: number;
  userId: string;
};

export type ListSolicitudesRecientesInput = {
  createdFrom?: string;
  createdTo?: string;
  excludeEstado?: string;
  estado?: string;
  limit: number;
  nroDocumento?: string;
  offset: number;
};

export type ListSolicitudesHistoricasInput = {
  limit: number;
  nroDocumento?: string;
  offset: number;
};

export type UpdateSolicitudCorePatch = {
  conyuge?:
    | {
        actividad?: string | null;
        apellido?: string | null;
        fechaNacimiento?: string | null;
        ingresosMensuales?: number | null;
        nacionalidad?: string | null;
        nombre?: string | null;
        nroDocumento?: string | null;
        sexo?: string | null;
        tipoDocumento?: string | null;
      }
    | null;
  garantias?: SolicitudCoreGarantia[];
  datosLaborales?: {
    actividadLaboral?: string | null;
    antiguedadLaboralMeses?: number | null;
    descuentosSueldo?: number | null;
    domicilioLaboralCalle?: string | null;
    domicilioLaboralLocalidad?: string | null;
    domicilioLaboralNroPuerta?: string | null;
    domicilioLaboralPisoDepto?: string | null;
    empleador?: string | null;
    fechaIngresoLaboral?: string | null;
    montoRecibo?: number | null;
    relacionLaboral?: string | null;
    tarjetas?: string | null;
    vehiculo?: string | null;
    vivienda?: string | null;
  };
  solicitud?: {
    cuotaResultante?: string | null;
    cuotas?: number | null;
    ejecutivoSolicitud?: string | null;
    legacyOid?: string;
    linkFirmaDigital?: string | null;
    firmaDigitalmente?: boolean;
    lineaPrestamoDescripcion?: string;
    lineaPrestamoLegacyOid?: string;
    montoAFinanciar?: number | null;
    motivo?: string | null;
    observaciones?: string | null;
    vendedorSolicitud?: string | null;
    cupoTitular?: number | null;
    fechaPrimerVencimiento?: string | null;
    nroOperacion?: string | null;
  };
  titular?: {
    apellidoDenominacion?: string;
    cbu?: string | null;
    celular?: string | null;
    cuit?: string | null;
    domicilioCalle?: string | null;
    email?: string | null;
    localidad?: string | null;
    nombre?: string;
    nroDocumento?: string;
    nroPuerta?: string | null;
    nroSocio?: string | null;
    tipoDocumento?: string;
    personaExpuestaPoliticamente?: boolean | null;
    estadoCivil?: string | null;
    fechaNacimiento?: string | null;
    nacionalidad?: string | null;
    sexo?: string | null;
    telefonoFijo?: string | null;
  };
};

export type GetSolicitudesStatsInput = {
  fechaDesde?: string;
  fechaHasta?: string;
  linea?: string;
  estado?: string;
  area?: string;
  vendedorId?: string;
  asignadoId?: string;
};

export type SolicitudesStatsResult = {
  kpis: {
    creadasPeriodo: number;
    backlogActivo: number;
    sinAsignar: number;
    detenidas7dias: number;
    rechazadas: number;
    desestimadas: number;
    vencidas: number;
  };
  backlogPorEstado: Array<{ estado: string; count: number }>;
  backlogPorArea: Array<{ area: string; count: number }>;
  rendimientoPorLinea: Array<{ linea: string; count: number }>;
  calidadDatos: {
    sinEjecutivo: number;
  };
  solicitudesAntiguas: Array<{
    id: string;
    titular: string;
    linea: string;
    estado: string;
    diasActiva: number;
  }>;
  solicitudesSinAsignar: Array<{
    id: string;
    titular: string;
    linea: string;
    estado: string;
    diasActiva: number;
  }>;
  funnelPeriodo: {
    confirmadas: number;
    liquidadas: number;
    verificacionFirma: number;
    transferidas: number;
  };
  filterOptions: {
    vendedores: Array<{ id: string; fullName: string }>;
    estados: Array<{ code: string; name: string }>;
    areas: Array<{ code: string; name: string }>;
    lineas: string[];
  };
};

export type VendedorDashboardStatsResult = {
  kpis: {
    montoLiquidado: number;
    aprobadoSinLiquidar: number;
    solicitudesIniciadas: number;
    tiempoPromedioDiasLiquidacion: number | null;
  };
  evolucionMensual: Array<{ periodo: string; monto: number }>;
  solicitudesPorEstado: Array<{ estado: string; count: number }>;
  funnel: Array<{ estado: string; count: number }>;
  montosPorLinea: Array<{ linea: string; monto: number; count: number }>;
  pendientes: Array<{
    id: string;
    titular: string;
    linea: string;
    estado: string;
    monto: number;
    diasActiva: number;
  }>;
  filterOptions: {
    lineas: string[];
  };
};

export type GetAnalistaStatsInput = GetSolicitudesStatsInput & {
  analistaId: string;
  areaOwnerCode: string;
  vista: "mis_casos" | "sin_asignar" | "ambos";
  conRetrabajo?: "con" | "sin";
  umbralDias: number;
};

export type AnalistaDashboardStatsResult = {
  kpis: {
    asignadosAMi: number;
    sinAsignarEnMiArea: number;
    detenidosMasDeNDias: number;
    casosConRevision: number;
    tasaDeRechazoPeriodo: number | null;
  };
  backlogPorEstado: Array<{ estado: string; count: number }>;
  retrabajoYRevisiones: {
    conRetrabajo: number;
    tresOMasRevisiones: number;
    promedioRevisionesPorCaso: number;
  };
  casosParaTomar: Array<{
    id: string;
    titular: string;
    linea: string;
    vendedor: string;
    diasEnCola: number;
  }>;
  casosConMultiplesRevisiones: Array<{
    id: string;
    titular: string;
    estado: string;
    cantidadRevisiones: number;
  }>;
  transicionesLentas: Array<{
    id: string;
    titular: string;
    estadoActual: string;
    estadoDestinoEsperado: string;
    diasAcumulados: number;
  }>;
  filterOptions: {
    estados: Array<{ code: string; name: string }>;
    lineas: string[];
    vendedores: Array<{ id: string; fullName: string }>;
  };
};

export type AnalistaDashboardStatsV2Result = {
  kpis: {
    asignadosAMi: number;
    sinAsignarEnMiArea: number;
    detenidosMasDeNDias: number;
    casosConRevision: number;
  };
  misCasosActivos: Array<{
    id: string;
    titular: string;
    linea: string;
    estado: string;
    turno: "mia" | "otro";
    diasAcumulados: number;
    cantidadRevisiones: number;
    volvioCorregido: boolean;
  }>;
  casosParaTomar: Array<{
    id: string;
    titular: string;
    linea: string;
    vendedor: string;
    diasEnCola: number;
  }>;
  historialTrabajo: Array<{
    solicitudId: string;
    fecha: string;
    titular: string;
    accion: string;
    resultado: string;
  }>;
  filterOptions: {
    estados: Array<{ code: string; name: string }>;
    lineas: string[];
    vendedores: Array<{ id: string; fullName: string }>;
  };
};

export type SolicitudesCoreRepository = {
  assignToUserIfUnassigned?(input: {
    actorUserId: string;
    allowReassignment?: boolean;
    solicitudId: string;
    assignedToUserId: string;
  }): Promise<SolicitudCore | null>;
  create(input: CreateSolicitudCoreRecord): Promise<SolicitudCore>;
  findById(id: string): Promise<SolicitudCore | null>;
  findByLegacyOid?(legacyOid: string): Promise<SolicitudCore | null>;
  findWorkflowOwnerCodeById?(id: string): Promise<string | null>;
  findUserById?(id: string): Promise<{ id: string; workflowOwnerId: string | null } | null>;
  listUsersByWorkflowOwnerId?(workflowOwnerId?: string): Promise<
    Array<{
      id: string;
      fullName: string | null;
      email: string | null;
    }>
  >;
  listByOwner(input: ListSolicitudesByOwnerInput): Promise<SolicitudCore[]>;
  listHistoricas?(input: ListSolicitudesHistoricasInput): Promise<SolicitudCore[]>;
  listRecientes?(input: ListSolicitudesRecientesInput): Promise<SolicitudCore[]>;
  listTracking?(input: ListSolicitudesTrackingInput): Promise<SolicitudCore[]>;
  getStats?(input: GetSolicitudesStatsInput): Promise<SolicitudesStatsResult>;
  getVendedorStats?(input: GetSolicitudesStatsInput): Promise<VendedorDashboardStatsResult>;
  getAnalistaStats?(input: GetAnalistaStatsInput): Promise<AnalistaDashboardStatsResult>;
  getAnalistaStatsV2?(input: GetAnalistaStatsInput): Promise<AnalistaDashboardStatsV2Result>;
  update(id: string, patch: UpdateSolicitudCorePatch): Promise<SolicitudCore>;
};
