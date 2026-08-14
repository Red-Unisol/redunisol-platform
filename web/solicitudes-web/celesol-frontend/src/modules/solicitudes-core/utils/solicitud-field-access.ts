import type {
  SolicitudCoreCapabilitiesResponse,
  SolicitudFieldGroup,
  SolicitudFieldKey,
} from "@/modules/solicitudes/types/solicitudes-core";

export const GARANTIAS_FIELD_KEYS = [
  "garantias.antiguedadLaboralMeses",
  "garantias.casadoConTitular",
  "garantias.celular",
  "garantias.cuit",
  "garantias.denominacion",
  "garantias.domicilio",
  "garantias.edad",
  "garantias.email",
  "garantias.estadoCivil",
  "garantias.fechaIngresoLaboral",
  "garantias.fechaNacimiento",
  "garantias.ingresoMensual",
  "garantias.nacionalidad",
  "garantias.nombre",
  "garantias.nombreCompleto",
  "garantias.nroDocumento",
  "garantias.nroSocio",
  "garantias.observaciones",
  "garantias.ocupacion",
  "garantias.persona",
  "garantias.sexo",
  "garantias.sumaIngresos",
  "garantias.telefono",
  "garantias.tipoDocumento",
  "garantias.tipoGarantia",
  "garantias.tipoRelacion",
] as const satisfies readonly SolicitudFieldKey[];

export function isFieldEditable(
  capabilities: SolicitudCoreCapabilitiesResponse | undefined,
  fieldKey: SolicitudFieldKey,
) {
  const fieldAccess = capabilities?.fieldAccess;

  if (!fieldAccess) {
    return false;
  }

  if (fieldAccess.editableFields.includes(fieldKey)) {
    return true;
  }

  return (
    fieldKey.startsWith("garantias.") &&
    fieldAccess.editableGroups.includes("garantias")
  );
}

export function isGroupEditable(
  capabilities: SolicitudCoreCapabilitiesResponse | undefined,
  groupKey: SolicitudFieldGroup,
) {
  const fieldAccess = capabilities?.fieldAccess;

  if (!fieldAccess) {
    return false;
  }

  return fieldAccess.editableGroups.includes(groupKey);
}

export function areAllGarantiasFieldsEditable(
  capabilities: SolicitudCoreCapabilitiesResponse | undefined,
) {
  return GARANTIAS_FIELD_KEYS.every((fieldKey) =>
    isFieldEditable(capabilities, fieldKey),
  );
}

export function hasAnyGarantiasFieldEditable(
  capabilities: SolicitudCoreCapabilitiesResponse | undefined,
) {
  return GARANTIAS_FIELD_KEYS.some((fieldKey) =>
    isFieldEditable(capabilities, fieldKey),
  );
}

export function hasAnySolicitudFieldEditable(
  capabilities: SolicitudCoreCapabilitiesResponse | undefined,
) {
  const fieldAccess = capabilities?.fieldAccess;

  if (!fieldAccess) {
    return false;
  }

  return (
    fieldAccess.editableFields.length > 0 ||
    fieldAccess.editableGroups.length > 0
  );
}
