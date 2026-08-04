export type CreateSolicitudCoreTitularRequest = {
  apellidoDenominacion: string;
  cbu?: string;
  celular?: string;
  cuit?: string;
  domicilioCalle?: string;
  email?: string;
  estadoCivil?: string;
  fechaNacimiento?: string;
  localidad?: string;
  nacionalidad?: string;
  nombre: string;
  nroDocumento: string;
  nroPuerta?: string;
  nroSocio?: string;
  personaExpuestaPoliticamente?: boolean;
  sexo?: string;
  telefonoFijo?: string;
  tipoDocumento: string;
};

export type CreateSolicitudCoreDatosLaboralesRequest = {
  actividadLaboral?: string;
  antiguedadLaboralMeses?: number;
  descuentosSueldo?: number;
  domicilioLaboralCalle?: string;
  domicilioLaboralLocalidad?: string;
  domicilioLaboralNroPuerta?: string;
  domicilioLaboralPisoDepto?: string;
  empleador?: string;
  fechaIngresoLaboral?: string;
  montoRecibo?: number;
  relacionLaboral?: string;
  tarjetas?: string;
  vehiculo?: string;
  vivienda?: string;
};

export type CreateSolicitudCoreConyugeRequest = {
  actividad?: string;
  apellido?: string;
  fechaNacimiento?: string;
  ingresosMensuales?: number;
  nacionalidad?: string;
  nombre?: string;
  nroDocumento?: string;
  sexo?: string;
  tipoDocumento?: string;
};

export type CreateSolicitudCoreGarantiaRequest = {
  antiguedadLaboralMeses?: number;
  casadoConTitular?: boolean;
  celular?: string;
  cuit?: string;
  denominacion?: string;
  domicilio?: string;
  edad?: number;
  email?: string;
  estadoCivil?: string;
  fechaIngresoLaboral?: string;
  fechaNacimiento?: string;
  ingresoMensual?: number;
  nacionalidad?: string;
  nombre?: string;
  nombreCompleto?: string;
  nroDocumento?: string;
  nroSocio?: string;
  observaciones?: string;
  ocupacion?: string;
  persona?: string;
  sexo?: string;
  sumaIngresos?: boolean;
  telefono?: string;
  tipoDocumento?: string;
  tipoGarantia?: string;
  tipoRelacion?: string;
};

export type CreateSolicitudCoreRequest = {
  conyuge?: CreateSolicitudCoreConyugeRequest;
  cuotaResultante?: string;
  cuotas?: number;
  cupoTitular?: number;
  datosLaborales: CreateSolicitudCoreDatosLaboralesRequest;
  ejecutivoSolicitud?: string;
  linkFirmaDigital?: string | null;
  firmaDigitalmente?: boolean;
  garantias?: CreateSolicitudCoreGarantiaRequest[];
  fechaPrimerVencimiento?: string;
  lineaPrestamoLegacyOid: string;
  montoAFinanciar?: number;
  motivo?: string;
  observaciones?: string;
  nroOperacion?: string;
  titular: CreateSolicitudCoreTitularRequest;
  vendedorSolicitud?: string;
};

type NullablePatchScalar = boolean | number | string;

type PatchRequest<T> = {
  [K in keyof T]?: T[K] extends NullablePatchScalar
    ? T[K] | null
    : T[K] extends Array<infer U>
      ? U[] | null
      : T[K] extends object
        ? PatchRequest<T[K]> | null
        : T[K];
};

export type PatchSolicitudCoreTitularRequest =
  PatchRequest<CreateSolicitudCoreTitularRequest>;

export type PatchSolicitudCoreDatosLaboralesRequest =
  PatchRequest<CreateSolicitudCoreDatosLaboralesRequest>;

export type PatchSolicitudCoreConyugeRequest =
  PatchRequest<CreateSolicitudCoreConyugeRequest>;

export type PatchSolicitudCoreGarantiaRequest =
  PatchRequest<CreateSolicitudCoreGarantiaRequest>;

export type PatchSolicitudCoreRequest = Omit<
  PatchRequest<CreateSolicitudCoreRequest>,
  "garantias"
> & {
  garantias?: PatchSolicitudCoreGarantiaRequest[] | null;
};

export type SolicitudCoreWorkflowStateResponse = {
  code: string;
  id: string;
  name: string;
  owner?: {
    code: string;
    id: string;
    name: string;
  };
  ownerId?: string;
};

export type SolicitudCoreCapabilitiesResponse = {
  canView: boolean;
  canEdit: boolean;
  canUploadAdjuntos: boolean;
  canDeleteAdjuntos: boolean;
  canDownloadAdjuntos: boolean;
  canManageCancelaciones: boolean;
  canChangeState: boolean;
  canViewHistory: boolean;
  fieldAccess?: SolicitudFieldAccessResponse;
};

export type SolicitudCoreAppearance = {
  backgroundColor: string | null;
  textColor: string | null;
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

export type SolicitudFieldAccessResponse = {
  defaultMode: "readonly";
  editableFields: SolicitudFieldKey[];
  editableGroups: SolicitudFieldGroup[];
  readonlyReason?: string;
};

export type WorkflowTransitionOwner = {
  code: string;
  name: string;
};

export type WorkflowTransitionState = {
  code: string;
  name: string;
  owner: WorkflowTransitionOwner;
};

export type WorkflowTransition = {
  actionCode: string;
  actionLabel: string;
  blockedReason: string | null;
  defaultComment: string | null;
  description: string | null;
  id: string;
  requiresComment: boolean;
  saveAndExit: boolean;
  sortOrder: number;
  toState: WorkflowTransitionState;
};

export type ExecuteWorkflowTransitionRequest = {
  actionCode: string;
  comment?: string;
  reason?: string;
};

export type ExecuteWorkflowTransitionResponse = {
  solicitud: SolicitudCoreResponse;
  transitions: WorkflowTransition[];
};

export type SolicitudWorkflowHistoryStateSnapshot = {
  code: string | null;
  name: string | null;
  ownerCode: string | null;
  ownerName: string | null;
};

export type SolicitudCoreWorkflowHistoryActionCode =
  | "ASSIGNMENT_SET"
  | "ASSIGNMENT_CLEARED_ON_OWNER_CHANGE"
  | (string & {});

export type SolicitudCoreWorkflowHistoryItem = {
  actionCode: SolicitudCoreWorkflowHistoryActionCode | null;
  actionLabel: string | null;
  changedAt: string;
  changedBy: string | null;
  changedByFullName?: string | null;
  comentario: string | null;
  estadoAnterior: SolicitudWorkflowHistoryStateSnapshot;
  estadoNuevo: SolicitudWorkflowHistoryStateSnapshot & {
    code: string;
    name: string;
  };
  id: string;
  motivo: string | null;
  solicitudId: string;
};

export type SolicitudCoreAssignedUserResponse = {
  email: string | null;
  fullName: string | null;
  id: string;
};

export type SolicitudCoreAssignableAgent = {
  email: string | null;
  fullName: string | null;
  id: string;
};

export type SolicitudCoreTitularResponse = {
  apellidoDenominacion: string | null;
  cbu: string | null;
  celular: string | null;
  cuit: string | null;
  domicilioCalle: string | null;
  email: string | null;
  estadoCivil: string | null;
  fechaNacimiento: string | null;
  localidad: string | null;
  nacionalidad: string | null;
  nombre: string | null;
  nroDocumento: string | null;
  nroPuerta: string | null;
  nroSocio: string | null;
  personaExpuestaPoliticamente: boolean | null;
  sexo: string | null;
  telefonoFijo: string | null;
  tipoDocumento: string | null;
};

export type SolicitudCoreDatosLaboralesResponse = {
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

export type SolicitudCoreConyugeResponse = {
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

export type SolicitudCoreGarantiaResponse = {
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

export type SolicitudCoreResponse = {
  assignedToUser: SolicitudCoreAssignedUserResponse | null;
  assignedToUserId: string | null;
  appearance?: SolicitudCoreAppearance;
  capabilities?: SolicitudCoreCapabilitiesResponse;
  conyuge: SolicitudCoreConyugeResponse | null;
  createdAt: string;
  createdBy: string;
  cuotaResultante: string | null;
  cuotas: number | null;
  cupoTitular: number | null;
  datosLaborales: SolicitudCoreDatosLaboralesResponse;
  ejecutivoSolicitud: string | null;
  linkFirmaDigital: string | null;
  estadoActual: SolicitudCoreWorkflowStateResponse;
  firmaDigitalmente: boolean;
  garantias: SolicitudCoreGarantiaResponse[];
  id: string;
  legacyOid: string | null;
  lineaPrestamoDescripcion: string;
  lineaPrestamoLegacyOid: string;
  fechaPrimerVencimiento: string | null;
  montoAFinanciar: number | null;
  motivo: string | null;
  nroSolicitud: string | null;
  nroOperacion: string | null;
  observaciones: string | null;
  titular: SolicitudCoreTitularResponse;
  updatedAt: string;
  vendedorSolicitud: string | null;
};

export type ListSolicitudesCoreQuery = {
  createdFrom?: string;
  createdTo?: string;
  excludeEstado?: string;
  estado?: string;
  limit: number;
  nroDocumento?: string;
  offset: number;
  scope?: "historicas" | "recientes" | "tracking" | "work";
};

export type SolicitudCoreListItem = {
  assignedToUser: SolicitudCoreAssignedUserResponse | null;
  assignedToUserId: string | null;
  appearance?: SolicitudCoreAppearance;
  capabilities?: SolicitudCoreCapabilitiesResponse;
  conyuge: SolicitudCoreConyugeResponse | null;
  createdAt: string;
  createdBy: string;
  cuotaResultante: string | null;
  cuotas: number | null;
  datosLaborales: SolicitudCoreDatosLaboralesResponse;
  ejecutivoSolicitud: string | null;
  linkFirmaDigital: string | null;
  estadoActual: SolicitudCoreWorkflowStateResponse;
  firmaDigitalmente: boolean;
  garantias: SolicitudCoreGarantiaResponse[];
  id: string;
  legacyOid: string | null;
  lineaPrestamoDescripcion: string;
  lineaPrestamoLegacyOid: string;
  montoAFinanciar: number | null;
  motivo: string | null;
  nroSolicitud: string | null;
  observaciones: string | null;
  ultimaNovedad: string | null;
  titular: SolicitudCoreTitularResponse;
  updatedAt: string;
  vendedorSolicitud: string | null;
};

export type CreateSolicitudCoreResponse = {
  assignedToUser: SolicitudCoreAssignedUserResponse | null;
  assignedToUserId: string | null;
  conyuge: SolicitudCoreConyugeResponse | null;
  createdAt: string;
  createdBy: string;
  cuotaResultante: string | null;
  cuotas: number | null;
  cupoTitular: number | null;
  datosLaborales: SolicitudCoreDatosLaboralesResponse;
  ejecutivoSolicitud: string | null;
  linkFirmaDigital: string | null;
  estadoActual: SolicitudCoreWorkflowStateResponse;
  firmaDigitalmente: boolean;
  garantias: SolicitudCoreGarantiaResponse[];
  id: string;
  legacyOid: string | null;
  lineaPrestamoDescripcion: string;
  lineaPrestamoLegacyOid: string;
  fechaPrimerVencimiento: string | null;
  montoAFinanciar: number | null;
  motivo: string | null;
  nroSolicitud: string | null;
  nroOperacion: string | null;
  observaciones: string | null;
  titular: SolicitudCoreTitularResponse;
  updatedAt: string;
  vendedorSolicitud: string | null;
};

export type UploadSolicitudCoreAdjuntoRequest = {
  adicional?: string;
  comentario?: string;
  descripcion?: string;
  file: File;
  nroDocumento?: string;
  restringido?: boolean;
  tipoAdjunto?: string;
};

export type UploadSolicitudCoreAdjuntoLoteItem = {
  adicional?: string;
  comentario?: string;
  descripcion?: string;
  file: File;
  nroDocumento?: string;
  restringido?: boolean;
  tipoAdjunto: string;
};

export type TipoAdjuntoCatalogItem = {
  label: string;
  value: string;
};

export type SimularPrestamoRequest = {
  capitalPuro: boolean;
  cuotas: number;
  fechaPrimerVencimiento?: string;
  lineaId: number;
  montoAFinanciar: number;
  tasa?: number;
};

export type SimulacionPrestamoCuota = {
  capital: number;
  fechaVencimiento: string;
  gastos: number;
  interes: number;
  numeroCuota: number;
  total: number;
};

export type SimulacionPrestamoResponse = {
  capital: number;
  capitalPuro: boolean;
  cuotaResultante: number;
  cuotas: number;
  cuotasDetalle: SimulacionPrestamoCuota[] | null;
  fechaPrimerVencimiento: string | null;
  fechaUltimaCuota: string;
  gastos: number;
  intereses: number;
  iva: number;
  lineaDescripcion: string | null;
  lineaId: number;
  montoAFinanciar: number;
  montoSujetoASellado: number;
  sellado: number;
  tasa: number;
  tem: number;
  total: number;
};

export type PendingSolicitudCoreAdjunto = UploadSolicitudCoreAdjuntoRequest & {
  localId: string;
};

export type SolicitudCoreAdjuntoResponse = {
  adicional: string | null;
  archivoMimeType: string | null;
  archivoNombre: string | null;
  archivoPath: string | null;
  archivoSizeBytes: number | null;
  comentario: string | null;
  deleteReason: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  descripcion: string | null;
  estadoAdjunto: string | null;
  id: string;
  nroDocumento: string | null;
  restringido: boolean;
  solicitudId: string;
  storageBucket: string | null;
  tipoAdjunto: string | null;
  updatedAt: string;
  uploadedAt: string;
  uploadedBy: string | null;
  uploadedByName?: string | null;
};

export type DownloadSolicitudCoreAdjuntoResponse = {
  blob: Blob;
  contentType: string | null;
  fileName: string | null;
};

export type PatchSolicitudCoreAdjuntoRequest = {
  adicional?: string;
  comentario?: string;
  descripcion?: string;
  nroDocumento?: string;
  restringido?: boolean;
  tipoAdjunto?: string;
};

export type SolicitudCoreCancelacionResponse = {
  cbu: string;
  createdAt: string;
  createdBy: string | null;
  createdByName?: string | null;
  cuentaADebitar: string;
  cuentaBancaria: string;
  id: string;
  monto: number;
  notas: string | null;
  socio: string;
  socioLegacyId: string | null;
  solicitudId: string;
  updatedAt: string;
};

export type CreateSolicitudCoreCancelacionRequest = {
  cbu: string;
  cuentaADebitar: string;
  cuentaBancaria: string;
  monto: number;
  notas?: string;
  socio: string;
  socioLegacyId?: string;
};

export type UpdateSolicitudCoreCancelacionRequest = {
  cbu?: string;
  cuentaADebitar?: string;
  cuentaBancaria?: string;
  monto?: number;
  notas?: string;
  socio?: string;
  socioLegacyId?: string;
};
