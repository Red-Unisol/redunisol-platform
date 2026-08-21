import type {
  CreateSolicitudCoreGarantiaRequest,
  CreateSolicitudCoreRequest,
} from "@/modules/solicitudes/types/solicitudes-core";

import type { NuevaSolicitudFormValues } from "../types";
import { parseMoneyValue } from "./money-format";

function toTrimmedString(value: string) {
  const normalizedValue = value.trim();

  return normalizedValue ? normalizedValue : undefined;
}

function toRequiredTrimmedString(value: string) {
  return value.trim();
}

function toOptionalNumber(value: string) {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return undefined;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function toOptionalMoneyNumber(value: string) {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return undefined;
  }

  const parsedValue = parseMoneyValue(normalizedValue);

  return parsedValue > 0 ? parsedValue : undefined;
}

function hasEffectiveData(record: Record<string, unknown>) {
  return Object.values(record).some((value) => value !== undefined);
}

export function mapNuevaSolicitudFormToCreateSolicitudCoreRequest(
  values: NuevaSolicitudFormValues,
  options?: {
    garantias?: CreateSolicitudCoreGarantiaRequest[];
  },
): CreateSolicitudCoreRequest {
  const conyuge = {
    actividad: toTrimmedString(values.actividadConyuge),
    apellido: toTrimmedString(values.apellidoConyuge),
    fechaNacimiento: toTrimmedString(values.fechaNacimientoConyuge),
    ingresosMensuales: toOptionalMoneyNumber(values.ingresosConyuge),
    nacionalidad: toTrimmedString(values.nacionalidadConyuge),
    nroDocumento: toTrimmedString(values.noDocumentoConyuge),
    sexo: toTrimmedString(values.sexoConyuge),
    tipoDocumento: toTrimmedString(values.tipoDocumentoConyuge),
  };

  return {
    conyuge: hasEffectiveData(conyuge) ? conyuge : undefined,
    cuotaResultante: toTrimmedString(values.cuotaResultante),
    cuotas: toOptionalNumber(values.cuotas),
    cupoTitular: toOptionalMoneyNumber(values.cupoTitular),
    datosLaborales: {
      actividadLaboral: toTrimmedString(values.actividadLaboral),
      antiguedadLaboralMeses: toOptionalNumber(values.antiguedadLaboral),
      descuentosSueldo: toOptionalMoneyNumber(values.descuentosSueldo),
      domicilioLaboralCalle: toTrimmedString(values.domicilioLaboralCalle),
      domicilioLaboralLocalidad: toTrimmedString(values.localidadLaboral),
      domicilioLaboralNroPuerta: toTrimmedString(values.noPuertaLaboral),
      domicilioLaboralPisoDepto: toTrimmedString(values.pisoDeptoLaboral),
      empleador: toTrimmedString(values.empleador),
      fechaIngresoLaboral: toTrimmedString(values.fechaIngresoLaboral),
      montoRecibo: toOptionalMoneyNumber(values.montoRecibo),
      relacionLaboral: toTrimmedString(values.relacionLaboral),
      tarjetas: toTrimmedString(values.tarjetas),
      vehiculo: toTrimmedString(values.vehiculo),
      vivienda: toTrimmedString(values.vivienda),
    },
    ejecutivoSolicitud: toTrimmedString(values.ejecutivoSolicitud),
    fechaPrimerVencimiento: toTrimmedString(values.fechaPrimerVencimiento),
    firmaDigitalmente: values.firmaDigitalmente,
    garantias:
      options?.garantias && options.garantias.length > 0
        ? options.garantias
        : undefined,
    lineaPrestamoLegacyOid: toRequiredTrimmedString(
      values.lineaPrestamoLegacyOid,
    ),
    montoAFinanciar: toOptionalMoneyNumber(values.montoAFinanciar),
    motivo: toTrimmedString(values.motivo),
    observaciones: toTrimmedString(values.observacionesSolicitud),
    nroOperacion: toTrimmedString(values.nroOperacion),
    titular: {
      apellidoDenominacion: toRequiredTrimmedString(
        values.apellidoDenominacion,
      ),
      cbu: toTrimmedString(values.cbu),
      celular: toTrimmedString(values.celular),
      cuit: toTrimmedString(values.cuit),
      domicilioCalle: toTrimmedString(values.domicilioCalle),
      email: toTrimmedString(values.email),
      estadoCivil: toTrimmedString(values.estadoCivil),
      fechaNacimiento: toTrimmedString(values.fechaNacimiento),
      localidad: toTrimmedString(values.localidad),
      nacionalidad: toTrimmedString(values.nacionalidad),
      nombre: toRequiredTrimmedString(values.nombre),
      nroDocumento: toRequiredTrimmedString(values.noDocumento),
      nroPuerta: toTrimmedString(values.noPuerta),
      nroSocio: toTrimmedString(values.noSocio),
      personaExpuestaPoliticamente: values.personaExpuestaPoliticamente,
      sexo: toTrimmedString(values.sexo),
      telefonoFijo: toTrimmedString(values.telefonoFijo),
      tipoDocumento: toRequiredTrimmedString(values.documento),
    },
  };
}
