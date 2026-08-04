export type SolicitudCoreState = {
  code: string;
  id: string;
  name: string;
  ownerId?: string;
  owner?: {
    code: string;
    id: string;
    name: string;
  };
};

export type SolicitudCoreParticipant = {
  userId: string;
  role?: string;
  source?: string;
};

export type SolicitudFieldKey =
  | "solicitud.cupoTitular"
  | "solicitud.cuotaResultante"
  | "solicitud.cuotas"
  | "solicitud.fechaPrimerVencimiento"
  | "solicitud.firmaDigitalmente"
  | "solicitud.linkFirmaDigital"
  | "solicitud.montoAFinanciar"
  | "solicitud.motivo"
  | "solicitud.nroOperacion"
  | "solicitud.observaciones"
  | "solicitud.vendedorSolicitud"
  | "titular.apellidoDenominacion"
  | "titular.cbu"
  | "titular.celular"
  | "titular.cuit"
  | "titular.domicilioCalle"
  | "titular.email"
  | "titular.estadoCivil"
  | "titular.fechaNacimiento"
  | "titular.localidad"
  | "titular.nacionalidad"
  | "titular.nombre"
  | "titular.nroDocumento"
  | "titular.nroPuerta"
  | "titular.nroSocio"
  | "titular.personaExpuestaPoliticamente"
  | "titular.sexo"
  | "titular.telefonoFijo"
  | "titular.tipoDocumento"
  | "conyuge.actividad"
  | "conyuge.apellido"
  | "conyuge.fechaNacimiento"
  | "conyuge.ingresosMensuales"
  | "conyuge.nacionalidad"
  | "conyuge.nombre"
  | "conyuge.nroDocumento"
  | "conyuge.sexo"
  | "conyuge.tipoDocumento"
  | "datosLaborales.actividadLaboral"
  | "datosLaborales.antiguedadLaboralMeses"
  | "datosLaborales.descuentosSueldo"
  | "datosLaborales.domicilioLaboralCalle"
  | "datosLaborales.domicilioLaboralLocalidad"
  | "datosLaborales.domicilioLaboralNroPuerta"
  | "datosLaborales.domicilioLaboralPisoDepto"
  | "datosLaborales.empleador"
  | "datosLaborales.fechaIngresoLaboral"
  | "datosLaborales.montoRecibo"
  | "datosLaborales.relacionLaboral"
  | "datosLaborales.tarjetas"
  | "datosLaborales.vehiculo"
  | "datosLaborales.vivienda"
  | "garantias.antiguedadLaboralMeses"
  | "garantias.casadoConTitular"
  | "garantias.celular"
  | "garantias.cuit"
  | "garantias.denominacion"
  | "garantias.domicilio"
  | "garantias.edad"
  | "garantias.email"
  | "garantias.estadoCivil"
  | "garantias.fechaIngresoLaboral"
  | "garantias.fechaNacimiento"
  | "garantias.ingresoMensual"
  | "garantias.nacionalidad"
  | "garantias.nombre"
  | "garantias.nombreCompleto"
  | "garantias.nroDocumento"
  | "garantias.nroSocio"
  | "garantias.observaciones"
  | "garantias.ocupacion"
  | "garantias.persona"
  | "garantias.sexo"
  | "garantias.sumaIngresos"
  | "garantias.telefono"
  | "garantias.tipoDocumento"
  | "garantias.tipoGarantia"
  | "garantias.tipoRelacion";

export type SolicitudFieldGroup =
  | "solicitud"
  | "titular"
  | "conyuge"
  | "datosLaborales"
  | "garantias";

export type SolicitudFieldAccess = {
  defaultMode: "readonly";
  editableFields: SolicitudFieldKey[];
  editableGroups: SolicitudFieldGroup[];
  readonlyReason?: string;
};

export type SolicitudAppearance = {
  backgroundColor: string | null;
  textColor: string | null;
};

export type SolicitudCoreCapabilities = {
  canView: boolean;
  canEdit: boolean;
  canUploadAdjuntos: boolean;
  canDeleteAdjuntos: boolean;
  canDownloadAdjuntos: boolean;
  canChangeState: boolean;
  canViewHistory: boolean;
  fieldAccess?: SolicitudFieldAccess;
};

export type SolicitudCoreTitular = {
  apellidoDenominacion: string | null;
  cbu: string | null;
  celular: string | null;
  cuit: string | null;
  domicilioCalle: string | null;
  email: string | null;
  localidad: string | null;
  nombre: string | null;
  personaExpuestaPoliticamente?: boolean | null;
  nroDocumento: string | null;
  nroPuerta: string | null;
  nroSocio: string | null;
  estadoCivil?: string | null;
  fechaNacimiento?: string | null;
  nacionalidad?: string | null;
  sexo?: string | null;
  telefonoFijo?: string | null;
  tipoDocumento: string | null;
};

export type SolicitudCoreDatosLaborales = {
  actividadLaboral: string | null;
  antiguedadLaboralMeses: number | null;
  descuentosSueldo: number | null;
  domicilioLaboralCalle: string | null;
  domicilioLaboralLocalidad: string | null;
  domicilioLaboralNroPuerta: string | null;
  domicilioLaboralPisoDepto: string | null;
  empleador: string | null;
  fechaIngresoLaboral: string | null;
  montoRecibo: number | null;
  relacionLaboral: string | null;
  tarjetas: string | null;
  vehiculo: string | null;
  vivienda: string | null;
};

export type SolicitudCoreConyuge = {
  actividad: string | null;
  apellido: string | null;
  fechaNacimiento: string | null;
  ingresosMensuales: number | null;
  nacionalidad: string | null;
  nombre: string | null;
  nroDocumento: string | null;
  sexo: string | null;
  tipoDocumento: string | null;
};

export type SolicitudCoreGarantia = {
  antiguedadLaboralMeses: number | null;
  casadoConTitular: boolean | null;
  celular: string | null;
  cuit: string | null;
  denominacion: string | null;
  domicilio: string | null;
  edad: number | null;
  email: string | null;
  estadoCivil: string | null;
  fechaIngresoLaboral: string | null;
  fechaNacimiento: string | null;
  ingresoMensual: number | null;
  nacionalidad: string | null;
  nombre: string | null;
  nombreCompleto: string | null;
  nroDocumento: string | null;
  nroSocio: string | null;
  observaciones: string | null;
  ocupacion: string | null;
  persona: string | null;
  sexo: string | null;
  sumaIngresos: boolean;
  telefono: string | null;
  tipoDocumento: string | null;
  tipoGarantia: string | null;
  tipoRelacion: string | null;
};

export type SolicitudCore = {
  appearance?: SolicitudAppearance;
  assignedToUser?: {
    email: string | null;
    fullName: string | null;
    id: string;
  } | null;
  assignedToUserId?: string | null;
  createdAt: Date;
  createdBy: string;
  cuotaResultante: string | null;
  cuotas: number | null;
  fechaPrimerVencimiento?: string | null;
  ejecutivoSolicitud: string | null;
  linkFirmaDigital?: string | null;
  estadoActual: SolicitudCoreState;
  firmaDigitalmente: boolean;
  id: string;
  garantias: SolicitudCoreGarantia[];
  legacyOid: string | null;
  lineaPrestamoDescripcion: string;
  lineaPrestamoLegacyOid: string;
  nroOperacion?: string | null;
  conyuge: SolicitudCoreConyuge | null;
  datosLaborales: SolicitudCoreDatosLaborales;
  montoAFinanciar: number | null;
  cupoTitular?: number | null;
  motivo: string | null;
  nroSolicitud: string | null;
  observaciones: string | null;
  ultimaNovedad?: string | null;
  capabilities?: SolicitudCoreCapabilities;
  participants?: SolicitudCoreParticipant[];
  titular: SolicitudCoreTitular;
  updatedAt: Date;
  vendedorSolicitud: string | null;
};
