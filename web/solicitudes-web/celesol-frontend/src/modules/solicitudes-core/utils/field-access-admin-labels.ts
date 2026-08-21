import type {
  FieldAccessAdminRuleSource,
  FieldAccessRulesListItem,
} from "@/modules/solicitudes-core/services/field-access-admin-api";

const FIELD_LABELS: Record<string, string> = {
  "solicitud.cupoTitular": "Cupo del titular",
  "solicitud.cuotaResultante": "Cuota resultante",
  "solicitud.cuotas": "Cuotas",
  "solicitud.fechaPrimerVencimiento": "Fecha del primer vencimiento",
  "solicitud.montoAFinanciar": "Monto a financiar",
  "solicitud.motivo": "Motivo",
  "solicitud.nroOperacion": "Número de operación",
  "solicitud.observaciones": "Observaciones",
  "solicitud.vendedorSolicitud": "Vendedor de la solicitud",
  "solicitud.lineaPrestamoLegacyOid": "Línea de préstamo",
  "solicitud.ejecutivoSolicitud": "Ejecutivo de la solicitud",
  "solicitud.linkFirmaDigital": "Link de firma digital",
  "solicitud.firmaDigitalmente": "Firma digital",
  "titular.apellidoDenominacion": "Apellido o denominación",
  "titular.cbu": "CBU",
  "titular.celular": "Celular",
  "titular.cuit": "CUIT",
  "titular.domicilioCalle": "Calle",
  "titular.email": "Email",
  "titular.estadoCivil": "Estado civil",
  "titular.localidad": "Localidad",
  "titular.nacionalidad": "Nacionalidad",
  "titular.nombre": "Nombre",
  "titular.nroDocumento": "Número de documento",
  "titular.nroPuerta": "Número de puerta",
  "titular.nroSocio": "Número de socio",
  "titular.personaExpuestaPoliticamente": "Persona expuesta políticamente",
  "titular.sexo": "Sexo",
  "titular.telefonoFijo": "Teléfono fijo",
  "titular.tipoDocumento": "Tipo de documento",
  "conyuge.actividad": "Actividad",
  "conyuge.apellido": "Apellido",
  "conyuge.fechaNacimiento": "Fecha de nacimiento",
  "conyuge.ingresosMensuales": "Ingresos mensuales",
  "conyuge.nacionalidad": "Nacionalidad",
  "conyuge.nombre": "Nombre",
  "conyuge.nroDocumento": "Número de documento",
  "conyuge.sexo": "Sexo",
  "conyuge.tipoDocumento": "Tipo de documento",
  "datosLaborales.actividadLaboral": "Actividad laboral",
  "datosLaborales.antiguedadLaboralMeses": "Antigüedad laboral",
  "datosLaborales.descuentosSueldo": "Descuentos del sueldo",
  "datosLaborales.domicilioLaboralCalle": "Calle laboral",
  "datosLaborales.domicilioLaboralLocalidad": "Localidad laboral",
  "datosLaborales.domicilioLaboralNroPuerta": "Número laboral",
  "datosLaborales.domicilioLaboralPisoDepto": "Piso o depto laboral",
  "datosLaborales.empleador": "Empleador",
  "datosLaborales.fechaIngresoLaboral": "Fecha de ingreso",
  "datosLaborales.montoRecibo": "Monto del recibo",
  "datosLaborales.relacionLaboral": "Relación laboral",
  "datosLaborales.tarjetas": "Tarjetas",
  "datosLaborales.vehiculo": "Vehículo",
  "datosLaborales.vivienda": "Vivienda",
  "garantias.antiguedadLaboralMeses": "Antigüedad laboral",
  "garantias.casadoConTitular": "Casado con titular",
  "garantias.celular": "Celular",
  "garantias.cuit": "CUIT",
  "garantias.denominacion": "Denominación",
  "garantias.domicilio": "Domicilio",
  "garantias.edad": "Edad",
  "garantias.email": "Email",
  "garantias.estadoCivil": "Estado civil",
  "garantias.fechaIngresoLaboral": "Fecha de ingreso laboral",
  "garantias.fechaNacimiento": "Fecha de nacimiento",
  "garantias.ingresoMensual": "Ingreso mensual",
  "garantias.nacionalidad": "Nacionalidad",
  "garantias.nombre": "Nombre",
  "garantias.nombreCompleto": "Nombre completo",
  "garantias.nroDocumento": "Número de documento",
  "garantias.nroSocio": "Número de socio",
  "garantias.observaciones": "Observaciones",
  "garantias.ocupacion": "Ocupación",
  "garantias.persona": "Persona",
  "garantias.sexo": "Sexo",
  "garantias.sumaIngresos": "Suma ingresos",
  "garantias.telefono": "Teléfono",
  "garantias.tipoDocumento": "Tipo de documento",
  "garantias.tipoGarantia": "Tipo de garantía",
  "garantias.tipoRelacion": "Tipo de relación",
};

const GROUP_LABELS: Record<string, string> = {
  solicitud: "Datos de la solicitud",
  titular: "Datos del titular",
  conyuge: "Datos del cónyuge",
  datosLaborales: "Datos laborales",
  garantias: "Garantías",
};

const SOURCE_LABELS: Record<
  FieldAccessAdminRuleSource,
  {
    description: string;
    label: string;
    tone: "danger" | "neutral" | "success" | "warning";
  }
> = {
  fallback_inactive: {
    description: "La regla existe, pero no está aplicada.",
    label: "Inactiva",
    tone: "warning",
  },
  fallback_invalid: {
    description: "La configuración tiene problemas y se ignora por seguridad.",
    label: "Inválida",
    tone: "danger",
  },
  fallback_missing: {
    description: "Todavía no hay una regla guardada para este estado.",
    label: "Sin configuración",
    tone: "neutral",
  },
  persisted: {
    description: "La regla guardada está disponible para este estado.",
    label: "Configurada",
    tone: "success",
  },
};

export function getFieldAccessFieldLabel(fieldKey: string) {
  return FIELD_LABELS[fieldKey] ?? humanizeFieldKey(fieldKey);
}

export function getFieldAccessGroupLabel(groupKey: string) {
  return GROUP_LABELS[groupKey] ?? humanizeToken(groupKey);
}

export function getFieldAccessSectionTitle(sectionKey: string) {
  return GROUP_LABELS[sectionKey] ?? humanizeToken(sectionKey);
}

export function getFieldAccessSourceStatus(source: FieldAccessAdminRuleSource) {
  return SOURCE_LABELS[source];
}

export function getFieldAccessEffectiveAccess(
  item: Pick<FieldAccessRulesListItem, "resolvedFieldAccess">,
) {
  const hasEditableValues =
    item.resolvedFieldAccess.editableFields.length > 0 ||
    item.resolvedFieldAccess.editableGroups.length > 0;

  return hasEditableValues
    ? {
        description:
          "En este estado va a haber datos habilitados para edición.",
        label: "Editable",
        tone: "success" as const,
      }
    : {
        description:
          "En este estado la solicitud queda sin campos habilitados para editar.",
        label: "Solo lectura",
        tone: "neutral" as const,
      };
}

export function getFieldAccessActiveStatus(active: boolean) {
  return active
    ? {
        label: "Activa",
        tone: "success" as const,
      }
    : {
        label: "Inactiva",
        tone: "warning" as const,
      };
}

export function getBadgeClasses(
  tone: "danger" | "neutral" | "success" | "warning",
) {
  switch (tone) {
    case "success":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "warning":
      return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "danger":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-background text-foreground-secondary";
  }
}

function humanizeFieldKey(fieldKey: string) {
  const token = fieldKey.split(".").at(-1) ?? fieldKey;
  return humanizeToken(token);
}

function humanizeToken(token: string) {
  const spaced = token
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .trim();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
