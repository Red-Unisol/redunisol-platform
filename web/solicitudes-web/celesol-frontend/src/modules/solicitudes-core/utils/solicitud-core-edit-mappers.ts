import type {
  PatchSolicitudCoreConyugeRequest,
  PatchSolicitudCoreDatosLaboralesRequest,
  PatchSolicitudCoreRequest,
  PatchSolicitudCoreTitularRequest,
  SolicitudCoreConyugeResponse,
  SolicitudCoreDatosLaboralesResponse,
  SolicitudCoreResponse,
  SolicitudCoreTitularResponse,
} from "@/modules/solicitudes/types/solicitudes-core";
import { parseMoneyValue } from "@/modules/solicitudes-editor/utils/money-format";
import {
  toDisplayPhone,
  toLegacyPhone,
} from "@/shared/utils/legacy-phone-format";

type EditableSolicitudSectionValues = {
  cuotaResultante: string;
  cuotas: string;
  ejecutivoSolicitud: string;
  linkFirmaDigital: string;
  firmaDigitalmente: boolean;
  fechaPrimerVencimiento: string;
  cupoTitular: string;
  montoAFinanciar: string;
  motivo: string;
  nroOperacion: string;
  observaciones: string;
  vendedorSolicitud: string;
};

type EditableTitularValues = {
  apellidoDenominacion: string;
  cbu: string;
  celular: string;
  cuit: string;
  domicilioCalle: string;
  email: string;
  estadoCivil: string;
  fechaNacimiento: string;
  localidad: string;
  nacionalidad: string;
  nombre: string;
  nroDocumento: string;
  nroPuerta: string;
  nroSocio: string;
  personaExpuestaPoliticamente: boolean;
  sexo: string;
  telefonoFijo: string;
  tipoDocumento: string;
};

type EditableConyugeValues = {
  actividad: string;
  apellido: string;
  fechaNacimiento: string;
  ingresosMensuales: string;
  nacionalidad: string;
  nombre: string;
  nroDocumento: string;
  sexo: string;
  tipoDocumento: string;
};

type EditableDatosLaboralesValues = {
  actividadLaboral: string;
  antiguedadLaboralMeses: string;
  descuentosSueldo: string;
  domicilioLaboralCalle: string;
  domicilioLaboralLocalidad: string;
  domicilioLaboralNroPuerta: string;
  domicilioLaboralPisoDepto: string;
  empleador: string;
  fechaIngresoLaboral: string;
  montoRecibo: string;
  relacionLaboral: string;
  tarjetas: string;
  vehiculo: string;
  vivienda: string;
};

export type EditableSolicitudCoreValues = {
  conyuge: EditableConyugeValues | null;
  datosLaborales: EditableDatosLaboralesValues;
  solicitud: EditableSolicitudSectionValues;
  titular: EditableTitularValues;
};

function toEditableString(value: string | null | undefined) {
  return value ?? "";
}

function toEditableNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function toEditableDate(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  return value;
}

function toComparableString(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function toOptionalStringPatch(
  nextValue: string,
  currentValue: string | null | undefined,
) {
  const normalizedNextValue = nextValue.trim();
  const normalizedCurrentValue = toComparableString(currentValue);

  if (!normalizedNextValue) {
    return normalizedCurrentValue ? null : undefined;
  }

  return normalizedNextValue === normalizedCurrentValue
    ? undefined
    : normalizedNextValue;
}

function toOptionalPhonePatch(
  nextValue: string,
  currentValue: string | null | undefined,
) {
  const normalizedNextValue = nextValue.trim();
  const currentDisplayValue = toDisplayPhone(currentValue);

  if (!normalizedNextValue) {
    return currentValue ? null : undefined;
  }

  return normalizedNextValue === currentDisplayValue
    ? undefined
    : toLegacyPhone(normalizedNextValue);
}

function toOptionalNumberPatch(
  nextValue: string,
  currentValue: number | null | undefined,
) {
  const normalizedNextValue = nextValue.trim();

  if (!normalizedNextValue) {
    return currentValue === null || currentValue === undefined
      ? undefined
      : null;
  }

  const parsedValue = Number(normalizedNextValue);

  if (!Number.isFinite(parsedValue)) {
    return undefined;
  }

  return parsedValue === currentValue ? undefined : parsedValue;
}

function toOptionalDatePatch(
  nextValue: string,
  currentValue: string | null | undefined,
) {
  const normalizedNextValue = nextValue.trim();
  const normalizedCurrentValue = toEditableDate(currentValue);

  if (!normalizedNextValue) {
    return normalizedCurrentValue ? null : undefined;
  }

  return normalizedNextValue === normalizedCurrentValue
    ? undefined
    : normalizedNextValue;
}

function toOptionalMoneyPatch(
  nextValue: string,
  currentValue: number | null | undefined,
) {
  const normalizedNextValue = nextValue.trim();

  if (!normalizedNextValue) {
    return currentValue === null || currentValue === undefined
      ? undefined
      : null;
  }

  const parsedValue = parseMoneyValue(normalizedNextValue);

  if (!Number.isFinite(parsedValue)) {
    return undefined;
  }

  return parsedValue === currentValue ? undefined : parsedValue;
}

function hasKeys(value: object) {
  return Object.keys(value).length > 0;
}

function buildTitularPatch(
  values: EditableTitularValues,
  titular: SolicitudCoreTitularResponse,
): PatchSolicitudCoreTitularRequest | undefined {
  const nextPatch: Record<string, unknown> = {};

  const apellidoDenominacion = toOptionalStringPatch(
    values.apellidoDenominacion,
    titular.apellidoDenominacion,
  );
  if (apellidoDenominacion !== undefined) {
    nextPatch.apellidoDenominacion = apellidoDenominacion;
  }

  const cbu = toOptionalStringPatch(values.cbu, titular.cbu);
  if (cbu !== undefined) {
    nextPatch.cbu = cbu;
  }

  const celular = toOptionalPhonePatch(values.celular, titular.celular);
  if (celular !== undefined) {
    nextPatch.celular = celular;
  }

  const cuit = toOptionalStringPatch(values.cuit, titular.cuit);
  if (cuit !== undefined) {
    nextPatch.cuit = cuit;
  }

  const domicilioCalle = toOptionalStringPatch(
    values.domicilioCalle,
    titular.domicilioCalle,
  );
  if (domicilioCalle !== undefined) {
    nextPatch.domicilioCalle = domicilioCalle;
  }

  const email = toOptionalStringPatch(values.email, titular.email);
  if (email !== undefined) {
    nextPatch.email = email;
  }

  const estadoCivil = toOptionalStringPatch(
    values.estadoCivil,
    titular.estadoCivil,
  );
  if (estadoCivil !== undefined) {
    nextPatch.estadoCivil = estadoCivil;
  }

  const titularFechaNacimiento = toOptionalDatePatch(
    values.fechaNacimiento,
    titular.fechaNacimiento,
  );
  if (titularFechaNacimiento !== undefined) {
    nextPatch.fechaNacimiento = titularFechaNacimiento;
  }

  const localidad = toOptionalStringPatch(values.localidad, titular.localidad);
  if (localidad !== undefined) {
    nextPatch.localidad = localidad;
  }

  const nacionalidad = toOptionalStringPatch(
    values.nacionalidad,
    titular.nacionalidad,
  );
  if (nacionalidad !== undefined) {
    nextPatch.nacionalidad = nacionalidad;
  }

  const nombre = toOptionalStringPatch(values.nombre, titular.nombre);
  if (nombre !== undefined) {
    nextPatch.nombre = nombre;
  }

  const nroDocumento = toOptionalStringPatch(
    values.nroDocumento,
    titular.nroDocumento,
  );
  if (nroDocumento !== undefined) {
    nextPatch.nroDocumento = nroDocumento;
  }

  const nroPuerta = toOptionalStringPatch(values.nroPuerta, titular.nroPuerta);
  if (nroPuerta !== undefined) {
    nextPatch.nroPuerta = nroPuerta;
  }

  const nroSocio = toOptionalStringPatch(values.nroSocio, titular.nroSocio);
  if (nroSocio !== undefined) {
    nextPatch.nroSocio = nroSocio;
  }

  if (
    values.personaExpuestaPoliticamente !==
    (titular.personaExpuestaPoliticamente ?? false)
  ) {
    nextPatch.personaExpuestaPoliticamente =
      values.personaExpuestaPoliticamente;
  }

  const sexo = toOptionalStringPatch(values.sexo, titular.sexo);
  if (sexo !== undefined) {
    nextPatch.sexo = sexo;
  }

  const telefonoFijo = toOptionalPhonePatch(
    values.telefonoFijo,
    titular.telefonoFijo,
  );
  if (telefonoFijo !== undefined) {
    nextPatch.telefonoFijo = telefonoFijo;
  }

  const tipoDocumento = toOptionalStringPatch(
    values.tipoDocumento,
    titular.tipoDocumento,
  );
  if (tipoDocumento !== undefined) {
    nextPatch.tipoDocumento = tipoDocumento;
  }

  return hasKeys(nextPatch)
    ? (nextPatch as PatchSolicitudCoreTitularRequest)
    : undefined;
}

function buildConyugePatch(
  values: EditableConyugeValues | null,
  conyuge: SolicitudCoreConyugeResponse | null,
): PatchSolicitudCoreConyugeRequest | undefined {
  if (!values || !conyuge) {
    return undefined;
  }

  const nextPatch: Record<string, unknown> = {};

  const actividad = toOptionalStringPatch(values.actividad, conyuge.actividad);
  if (actividad !== undefined) {
    nextPatch.actividad = actividad;
  }

  const apellido = toOptionalStringPatch(values.apellido, conyuge.apellido);
  if (apellido !== undefined) {
    nextPatch.apellido = apellido;
  }

  const fechaNacimiento = toOptionalDatePatch(
    values.fechaNacimiento,
    conyuge.fechaNacimiento,
  );
  if (fechaNacimiento !== undefined) {
    nextPatch.fechaNacimiento = fechaNacimiento;
  }

  const ingresosMensuales = toOptionalNumberPatch(
    values.ingresosMensuales,
    conyuge.ingresosMensuales,
  );
  if (ingresosMensuales !== undefined) {
    nextPatch.ingresosMensuales = ingresosMensuales;
  }

  const nacionalidad = toOptionalStringPatch(
    values.nacionalidad,
    conyuge.nacionalidad,
  );
  if (nacionalidad !== undefined) {
    nextPatch.nacionalidad = nacionalidad;
  }

  const nombre = toOptionalStringPatch(values.nombre, conyuge.nombre);
  if (nombre !== undefined) {
    nextPatch.nombre = nombre;
  }

  const nroDocumento = toOptionalStringPatch(
    values.nroDocumento,
    conyuge.nroDocumento,
  );
  if (nroDocumento !== undefined) {
    nextPatch.nroDocumento = nroDocumento;
  }

  const sexo = toOptionalStringPatch(values.sexo, conyuge.sexo);
  if (sexo !== undefined) {
    nextPatch.sexo = sexo;
  }

  const tipoDocumento = toOptionalStringPatch(
    values.tipoDocumento,
    conyuge.tipoDocumento,
  );
  if (tipoDocumento !== undefined) {
    nextPatch.tipoDocumento = tipoDocumento;
  }

  return hasKeys(nextPatch)
    ? (nextPatch as PatchSolicitudCoreConyugeRequest)
    : undefined;
}

function buildDatosLaboralesPatch(
  values: EditableDatosLaboralesValues,
  datosLaborales: SolicitudCoreDatosLaboralesResponse,
): PatchSolicitudCoreDatosLaboralesRequest | undefined {
  const nextPatch: Record<string, unknown> = {};

  const actividadLaboral = toOptionalStringPatch(
    values.actividadLaboral,
    datosLaborales.actividadLaboral,
  );
  if (actividadLaboral !== undefined) {
    nextPatch.actividadLaboral = actividadLaboral;
  }

  const antiguedadLaboralMeses = toOptionalNumberPatch(
    values.antiguedadLaboralMeses,
    datosLaborales.antiguedadLaboralMeses,
  );
  if (antiguedadLaboralMeses !== undefined) {
    nextPatch.antiguedadLaboralMeses = antiguedadLaboralMeses;
  }

  const descuentosSueldo = toOptionalNumberPatch(
    values.descuentosSueldo,
    datosLaborales.descuentosSueldo,
  );
  if (descuentosSueldo !== undefined) {
    nextPatch.descuentosSueldo = descuentosSueldo;
  }

  const domicilioLaboralCalle = toOptionalStringPatch(
    values.domicilioLaboralCalle,
    datosLaborales.domicilioLaboralCalle,
  );
  if (domicilioLaboralCalle !== undefined) {
    nextPatch.domicilioLaboralCalle = domicilioLaboralCalle;
  }

  const domicilioLaboralLocalidad = toOptionalStringPatch(
    values.domicilioLaboralLocalidad,
    datosLaborales.domicilioLaboralLocalidad,
  );
  if (domicilioLaboralLocalidad !== undefined) {
    nextPatch.domicilioLaboralLocalidad = domicilioLaboralLocalidad;
  }

  const domicilioLaboralNroPuerta = toOptionalStringPatch(
    values.domicilioLaboralNroPuerta,
    datosLaborales.domicilioLaboralNroPuerta,
  );
  if (domicilioLaboralNroPuerta !== undefined) {
    nextPatch.domicilioLaboralNroPuerta = domicilioLaboralNroPuerta;
  }

  const domicilioLaboralPisoDepto = toOptionalStringPatch(
    values.domicilioLaboralPisoDepto,
    datosLaborales.domicilioLaboralPisoDepto,
  );
  if (domicilioLaboralPisoDepto !== undefined) {
    nextPatch.domicilioLaboralPisoDepto = domicilioLaboralPisoDepto;
  }

  const empleador = toOptionalStringPatch(
    values.empleador,
    datosLaborales.empleador,
  );
  if (empleador !== undefined) {
    nextPatch.empleador = empleador;
  }

  const fechaIngresoLaboral = toOptionalDatePatch(
    values.fechaIngresoLaboral,
    datosLaborales.fechaIngresoLaboral,
  );
  if (fechaIngresoLaboral !== undefined) {
    nextPatch.fechaIngresoLaboral = fechaIngresoLaboral;
  }

  const montoRecibo = toOptionalNumberPatch(
    values.montoRecibo,
    datosLaborales.montoRecibo,
  );
  if (montoRecibo !== undefined) {
    nextPatch.montoRecibo = montoRecibo;
  }

  const relacionLaboral = toOptionalStringPatch(
    values.relacionLaboral,
    datosLaborales.relacionLaboral,
  );
  if (relacionLaboral !== undefined) {
    nextPatch.relacionLaboral = relacionLaboral;
  }

  const tarjetas = toOptionalStringPatch(
    values.tarjetas,
    datosLaborales.tarjetas,
  );
  if (tarjetas !== undefined) {
    nextPatch.tarjetas = tarjetas;
  }

  const vehiculo = toOptionalStringPatch(
    values.vehiculo,
    datosLaborales.vehiculo,
  );
  if (vehiculo !== undefined) {
    nextPatch.vehiculo = vehiculo;
  }

  const vivienda = toOptionalStringPatch(
    values.vivienda,
    datosLaborales.vivienda,
  );
  if (vivienda !== undefined) {
    nextPatch.vivienda = vivienda;
  }

  return hasKeys(nextPatch)
    ? (nextPatch as PatchSolicitudCoreDatosLaboralesRequest)
    : undefined;
}

export function mapSolicitudCoreToEditableValues(
  solicitud: SolicitudCoreResponse,
): EditableSolicitudCoreValues {
  return {
    conyuge: solicitud.conyuge
      ? {
          actividad: toEditableString(solicitud.conyuge.actividad),
          apellido: toEditableString(solicitud.conyuge.apellido),
          fechaNacimiento: toEditableDate(solicitud.conyuge.fechaNacimiento),
          ingresosMensuales: toEditableNumber(
            solicitud.conyuge.ingresosMensuales,
          ),
          nacionalidad: toEditableString(solicitud.conyuge.nacionalidad),
          nombre: toEditableString(solicitud.conyuge.nombre),
          nroDocumento: toEditableString(solicitud.conyuge.nroDocumento),
          sexo: toEditableString(solicitud.conyuge.sexo),
          tipoDocumento: toEditableString(solicitud.conyuge.tipoDocumento),
        }
      : null,
    datosLaborales: {
      actividadLaboral: toEditableString(
        solicitud.datosLaborales.actividadLaboral,
      ),
      antiguedadLaboralMeses: toEditableNumber(
        solicitud.datosLaborales.antiguedadLaboralMeses,
      ),
      descuentosSueldo: toEditableNumber(
        solicitud.datosLaborales.descuentosSueldo,
      ),
      domicilioLaboralCalle: toEditableString(
        solicitud.datosLaborales.domicilioLaboralCalle,
      ),
      domicilioLaboralLocalidad: toEditableString(
        solicitud.datosLaborales.domicilioLaboralLocalidad,
      ),
      domicilioLaboralNroPuerta: toEditableString(
        solicitud.datosLaborales.domicilioLaboralNroPuerta,
      ),
      domicilioLaboralPisoDepto: toEditableString(
        solicitud.datosLaborales.domicilioLaboralPisoDepto,
      ),
      empleador: toEditableString(solicitud.datosLaborales.empleador),
      fechaIngresoLaboral: toEditableDate(
        solicitud.datosLaborales.fechaIngresoLaboral,
      ),
      montoRecibo: toEditableNumber(solicitud.datosLaborales.montoRecibo),
      relacionLaboral: toEditableString(
        solicitud.datosLaborales.relacionLaboral,
      ),
      tarjetas: toEditableString(solicitud.datosLaborales.tarjetas),
      vehiculo: toEditableString(solicitud.datosLaborales.vehiculo),
      vivienda: toEditableString(solicitud.datosLaborales.vivienda),
    },
    solicitud: {
      cuotaResultante: toEditableString(solicitud.cuotaResultante),
      cuotas: toEditableNumber(solicitud.cuotas),
      ejecutivoSolicitud: toEditableString(solicitud.ejecutivoSolicitud),
      linkFirmaDigital: toEditableString(solicitud.linkFirmaDigital),
      firmaDigitalmente: solicitud.firmaDigitalmente,
      fechaPrimerVencimiento: toEditableDate(solicitud.fechaPrimerVencimiento),
      cupoTitular: toEditableNumber(solicitud.cupoTitular),
      montoAFinanciar: toEditableNumber(solicitud.montoAFinanciar),
      motivo: toEditableString(solicitud.motivo),
      nroOperacion: toEditableString(solicitud.nroOperacion),
      observaciones: toEditableString(solicitud.observaciones),
      vendedorSolicitud: toEditableString(solicitud.vendedorSolicitud),
    },
    titular: {
      apellidoDenominacion: toEditableString(
        solicitud.titular.apellidoDenominacion,
      ),
      cbu: toEditableString(solicitud.titular.cbu),
      celular: toDisplayPhone(solicitud.titular.celular),
      cuit: toEditableString(solicitud.titular.cuit),
      domicilioCalle: toEditableString(solicitud.titular.domicilioCalle),
      email: toEditableString(solicitud.titular.email),
      estadoCivil: toEditableString(solicitud.titular.estadoCivil),
      fechaNacimiento: toEditableDate(solicitud.titular.fechaNacimiento),
      localidad: toEditableString(solicitud.titular.localidad),
      nacionalidad: toEditableString(solicitud.titular.nacionalidad),
      nombre: toEditableString(solicitud.titular.nombre),
      nroDocumento: toEditableString(solicitud.titular.nroDocumento),
      nroPuerta: toEditableString(solicitud.titular.nroPuerta),
      nroSocio: toEditableString(solicitud.titular.nroSocio),
      personaExpuestaPoliticamente:
        solicitud.titular.personaExpuestaPoliticamente ?? false,
      sexo: toEditableString(solicitud.titular.sexo),
      telefonoFijo: toDisplayPhone(solicitud.titular.telefonoFijo),
      tipoDocumento: toEditableString(solicitud.titular.tipoDocumento),
    },
  };
}

export function mapEditableValuesToPatchSolicitudCoreRequest(
  values: EditableSolicitudCoreValues,
  solicitud: SolicitudCoreResponse,
): PatchSolicitudCoreRequest {
  const nextPatch: Record<string, unknown> = {};
  const solicitudPatch: Record<string, unknown> = {};

  const cuotaResultante = toOptionalStringPatch(
    values.solicitud.cuotaResultante,
    solicitud.cuotaResultante,
  );
  if (cuotaResultante !== undefined) {
    solicitudPatch.cuotaResultante = cuotaResultante;
  }

  const cuotas = toOptionalNumberPatch(
    values.solicitud.cuotas,
    solicitud.cuotas,
  );
  if (cuotas !== undefined) {
    solicitudPatch.cuotas = cuotas;
  }

  const cupoTitular = toOptionalMoneyPatch(
    values.solicitud.cupoTitular,
    solicitud.cupoTitular,
  );
  if (cupoTitular !== undefined) {
    solicitudPatch.cupoTitular = cupoTitular;
  }

  const ejecutivoSolicitud = toOptionalStringPatch(
    values.solicitud.ejecutivoSolicitud,
    solicitud.ejecutivoSolicitud,
  );
  if (ejecutivoSolicitud !== undefined) {
    solicitudPatch.ejecutivoSolicitud = ejecutivoSolicitud;
  }

  const linkFirmaDigital = toOptionalStringPatch(
    values.solicitud.linkFirmaDigital,
    solicitud.linkFirmaDigital,
  );
  if (linkFirmaDigital !== undefined) {
    solicitudPatch.linkFirmaDigital = linkFirmaDigital;
  }

  if (values.solicitud.firmaDigitalmente !== solicitud.firmaDigitalmente) {
    solicitudPatch.firmaDigitalmente = values.solicitud.firmaDigitalmente;
  }

  const montoAFinanciar = toOptionalNumberPatch(
    values.solicitud.montoAFinanciar,
    solicitud.montoAFinanciar,
  );
  if (montoAFinanciar !== undefined) {
    solicitudPatch.montoAFinanciar = montoAFinanciar;
  }

  const motivo = toOptionalStringPatch(
    values.solicitud.motivo,
    solicitud.motivo,
  );
  if (motivo !== undefined) {
    solicitudPatch.motivo = motivo;
  }

  const fechaPrimerVencimiento = toOptionalDatePatch(
    values.solicitud.fechaPrimerVencimiento,
    solicitud.fechaPrimerVencimiento,
  );
  if (fechaPrimerVencimiento !== undefined) {
    solicitudPatch.fechaPrimerVencimiento = fechaPrimerVencimiento;
  }

  const nroOperacion = toOptionalStringPatch(
    values.solicitud.nroOperacion,
    solicitud.nroOperacion,
  );
  if (nroOperacion !== undefined) {
    solicitudPatch.nroOperacion = nroOperacion;
  }

  const observaciones = toOptionalStringPatch(
    values.solicitud.observaciones,
    solicitud.observaciones,
  );
  if (observaciones !== undefined) {
    solicitudPatch.observaciones = observaciones;
  }

  const vendedorSolicitud = toOptionalStringPatch(
    values.solicitud.vendedorSolicitud,
    solicitud.vendedorSolicitud,
  );
  if (vendedorSolicitud !== undefined) {
    solicitudPatch.vendedorSolicitud = vendedorSolicitud;
  }

  const titular = buildTitularPatch(values.titular, solicitud.titular);
  if (titular) {
    nextPatch.titular = titular;
  }

  const conyuge = buildConyugePatch(values.conyuge, solicitud.conyuge);
  if (conyuge) {
    nextPatch.conyuge = conyuge;
  }

  const datosLaborales = buildDatosLaboralesPatch(
    values.datosLaborales,
    solicitud.datosLaborales,
  );
  if (datosLaborales) {
    nextPatch.datosLaborales = datosLaborales;
  }

  if (hasKeys(solicitudPatch)) {
    nextPatch.solicitud = solicitudPatch;
  }

  return nextPatch as PatchSolicitudCoreRequest;
}
