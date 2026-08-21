export type SolicitudPrecargaItem = {
  cuotas: number | null;
  cuotaResultante: string | null;
  estado: string | null;
  fecha: string | null;
  id: string;
  lineaPrestamo: string | null;
  montoAFinanciar: number | null;
  nombreCompleto: string | null;
  nroDocumento: string | null;
  nroSolicitud: string | null;
  oid: string | null;
  ultimaNovedad: string | null;
  vendedorSolicitud: string | null;
};

export type SolicitudRecienteItem = {
  cuotas: number | null;
  cuotaResultante: unknown | null;
  estado: string | null;
  fecha: string | null;
  id: string;
  lineaPrestamo: string | null;
  montoAFinanciar: number | null;
  nombreCompleto: string | null;
  nroDocumento: string | null;
  nroSolicitud: string | null;
  oid: string | null;
  ultimaNovedad: string | null;
  vendedorSolicitud: string | null;
};

export type SolicitudDetalleLegacy = {
  estado: string | null;
  fechaPrimerVencimiento: string | null;
  linea: string | null;
  montoAFinanciar: number | null;
  motivo: string | null;
  noInterno: string | null;
  nioOperacion: string | null;
  noSolicitud: string | null;
  ultimaNovedad: string | null;
  vendedorSolicitud: string | null;
};

export type SolicitudDetail = {
  conyuge: SolicitudDetailConyuge;
  economicosLaborales: SolicitudDetailEconomicosLaborales;
  solicitud: SolicitudDetailSolicitud;
  titular: SolicitudDetailTitular;
};

export type SolicitudDetailSolicitud = {
  cuotaResultante: string | null;
  cuotas: number | null;
  cupoTitular: number | null;
  ejecutivoSolicitud: string | null;
  estado: string | null;
  fechaPrimerVencimiento: string | null;
  fechaUltimaCuota: string | null;
  firmaDigitalmente: boolean | null;
  lineaPrestamoDescripcion: string | null;
  montoAFinanciar: number | null;
  montoMaximoAFinanciar: number | null;
  montoMaximoCuota: number | null;
  motivo: string | null;
  nroInterno: string | null;
  nroOperacion: string | null;
  nroSolicitud: string | null;
  observaciones: string | null;
  ultimaNovedad: string | null;
  vendedorSolicitud: string | null;
};

export type SolicitudDetailTitular = {
  apellido: string | null;
  cbu: string | null;
  celular: string | null;
  cuit: string | null;
  domicilioCalle: string | null;
  email: string | null;
  estadoCivil: string | null;
  fechaDeNacimiento: string | null;
  fechaIngresoLaboral: string | null;
  localidad: string | null;
  montoRecibo: number | null;
  nacionalidad: string | null;
  nombre: string | null;
  nroDocumento: string | null;
  nroPuerta: string | null;
  nroSocio: string | null;
  observaciones: string | null;
  pep: string | null;
  sexo: string | null;
  telefono: string | null;
  tipoDocumento: string | null;
  tycAceptado: boolean | null;
};

export type SolicitudDetailConyuge = {
  actividad: string | null;
  apellido: string | null;
  fechaNacimiento: string | null;
  ingresosMensuales: number | null;
  nacionalidad: string | null;
  nroDocumento: string | null;
  sexo: string | null;
  tipoDocumento: string | null;
};

export type SolicitudDetailEconomicosLaborales = {
  actividadLaboral: string | null;
  antiguedad: number | null;
  descuentosSueldo: number | null;
  domicilioLaboralCalle: string | null;
  domicilioLaboralLocalidad: string | null;
  domicilioLaboralNroPuerta: string | null;
  empleador: string | null;
  fechaIngresoLaboral: string | null;
  montoRecibo: number | null;
  pisoDepto: string | null;
  relacionLaboral: string | null;
  tarjetas: string | null;
  vehiculo: string | null;
  vivienda: string | null;
};

export type SocioMutualLegacy = {
  apellido: string | null;
  cbu: string | null;
  celular: string | null;
  cuit: string | null;
  domicilioCalle: string | null;
  email: string | null;
  estadoCivil: string | null;
  fechaDeNacimiento: string | null;
  localidad: string | null;
  nacionalidad: string | null;
  nombre: string | null;
  nroDoc: string | null;
  nroPuerta: string | null;
  nroSocio: string | null;
  pep: string | null;
  sexo: string | null;
  telefono: string | null;
  tipoDoc: string | null;
};

export type SocioMutualCancelacionListItem = {
  categoriaActualNombre: string | null;
  cuit: string | null;
  dadoDeBaja: boolean | null;
  id: string | null;
  nombreCompleto: string | null;
  nroDoc: string | null;
  nroSocio: string | null;
};

export type SocioMutualCancelacionDetalle = {
  apellido: string | null;
  categoriaActualId: string | null;
  categoriaActualNombre: string | null;
  categoriaFTId: string | null;
  categoriaFTNombre: string | null;
  celular: string | null;
  clasificacionPEP: string | null;
  cuentaBancariaHabitual: {
    cbu: string | null;
    nombre: string | null;
    nroCuenta: string | null;
    sucursalBanco: string | null;
  };
  cuentaDebitoCtaSocial: string | null;
  cuit: string | null;
  dadoDeBaja: boolean | null;
  email: string | null;
  estadoCivil: string | null;
  fechaDeNacimiento: string | null;
  id: string | null;
  nombre: string | null;
  nombreCompleto: string | null;
  nroDoc: string | null;
  nroSocio: string | null;
  pep: string | null;
  pepExterno: string | null;
  saldo: number | null;
  sexo: string | null;
  sujetoObligado: string | null;
  telefono: string | null;
  vinculoPEP: string | null;
  whatsapp: string | null;
};

// Datos del prestamo ya otorgado (F.Module.Cuentas.Prestamos.Prestamo),
// alcanzado como relacion anidada desde PreSolicitud.Module.Solicitud por
// Oid. Solo existe una vez que el legacy genero el prestamo -- antes de eso
// la consulta no encuentra el objeto.
export type PrestamoOtorgadoLegacy = {
  capital: number | null;
  cft: number | null;
  fechaEmision: string | null;
  montoPrestamo: number | null;
  nroCuenta: string | null;
  primerVencimiento: string | null;
  tea: number | null;
  tem: number | null;
  tna: number | null;
  vencimiento: string | null;
};

export type LineaPrestamoPresolicitud = {
  cantidadMaximaCuotas: number | null;
  cantidadMinimaCuotas: number | null;
  descripcion: string | null;
  montoMaximo: number | null;
  montoMinimo: number | null;
  oid: string | null;
  tasa: number | null;
  vigente: boolean | null;
};
