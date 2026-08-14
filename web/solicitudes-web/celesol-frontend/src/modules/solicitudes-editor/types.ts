import type {
  FieldErrors,
  UseFormRegister,
  UseFormReturn,
} from "react-hook-form";

export type NuevaSolicitudFormValues = {
  actividadConyuge: string;

  actividadLaboral: string;

  antiguedadLaboral: string;

  apellidoConyuge: string;

  apellidoDenominacion: string;

  celular: string;

  cbu: string;
  cbuTransferenciasCuentaNoHabitual: string;
  clit: string;
  cupoTitular: string;

  cuit: string;

  cuotaResultante: string;

  cuotas: string;

  documento: string;

  domicilioCalle: string;

  email: string;

  ejecutivoSolicitud: string;

  estado: string;

  estadoCivil: string;

  fechaIngresoLaboral: string;

  fechaNacimientoConyuge: string;

  fechaNacimiento: string;

  fechaPrimerVencimiento: string;

  firmaDigitalmente: boolean;

  ingresosConyuge: string;

  linea: string;
  lineaPrestamoLegacyOid: string;

  localidad: string;

  localidadLaboral: string;

  montoAFinanciar: string;

  montoRecibo: string;

  motivo: string;

  nacionalidad: string;

  nacionalidadConyuge: string;

  nombreConyuge: string;

  nroOperacion: string;

  noDocumento: string;

  noDocumentoConyuge: string;

  noPuerta: string;

  noPuertaLaboral: string;

  noSocio: string;

  noSolicitud: string;

  nombre: string;

  noInterno: string;

  observacionesSolicitud: string;

  personaExpuestaPoliticamente: boolean;

  pisoDeptoLaboral: string;

  relacionLaboral: string;

  descuentosSueldo: string;

  domicilioLaboralCalle: string;

  empleador: string;

  sexo: string;

  sexoConyuge: string;

  tarjetas: string;

  telefonoFijo: string;

  tipoDocumentoConyuge: string;

  ultimaNovedad: string;

  vehiculo: string;

  vendedorSolicitud: string;

  vivienda: string;
};

export type TabItem<TValue extends string> = {
  label: string;

  value: TValue;
};

export type SolicitanteTab = "adjuntos" | "solicitante";
export type NuevaSolicitudTab = "garantias" | "titular";
export type DatosPersonalesTab =
  | "adicionales"
  | "conyuge"
  | "datosPersonales"
  | "economicosLaborales";

export type LegacyOption = {
  label: string;

  value: string;
};

export type SolicitudFormControl =
  UseFormReturn<NuevaSolicitudFormValues>["control"];
export type SolicitudFormErrors = FieldErrors<NuevaSolicitudFormValues>;
export type SolicitudFormRegister = UseFormRegister<NuevaSolicitudFormValues>;
export type StyledSelectOption = {
  disabled?: boolean;
  disabledReason?: string;
  label: string;
  value: string;
};
