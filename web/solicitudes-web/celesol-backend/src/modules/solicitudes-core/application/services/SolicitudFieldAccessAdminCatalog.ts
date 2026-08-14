import type {
  SolicitudFieldGroup,
  SolicitudFieldKey,
} from "../../domain/entities/SolicitudCore.entity";
import {
  BLOCKED_FIELD_KEYS,
  CONYUGE_EDITABLE_FIELDS,
  DATOS_LABORALES_EDITABLE_FIELDS,
  GARANTIAS_EDITABLE_FIELDS,
  LEGACY_EDITABLE_GROUPS,
  READONLY_REASON,
  SOLICITUD_EDITABLE_FIELDS,
  TITULAR_EDITABLE_FIELDS,
} from "./SolicitudFieldAccess";

export const FIELD_ACCESS_ALLOWED_DEFAULT_MODES = ["readonly"] as const;

export const FIELD_ACCESS_GROUP_ORDER =
  [] as const satisfies readonly SolicitudFieldGroup[];

export const FIELD_ACCESS_CATALOG = {
  conyuge: [...CONYUGE_EDITABLE_FIELDS],
  datosLaborales: [...DATOS_LABORALES_EDITABLE_FIELDS],
  garantias: [...GARANTIAS_EDITABLE_FIELDS],
  solicitud: [...SOLICITUD_EDITABLE_FIELDS],
  titular: [...TITULAR_EDITABLE_FIELDS],
} as const satisfies Record<
  SolicitudFieldGroup,
  SolicitudFieldKey[]
>;

export const FIELD_ACCESS_ALL_FIELDS = [
  ...FIELD_ACCESS_CATALOG.solicitud,
  ...FIELD_ACCESS_CATALOG.titular,
  ...FIELD_ACCESS_CATALOG.conyuge,
  ...FIELD_ACCESS_CATALOG.datosLaborales,
  ...FIELD_ACCESS_CATALOG.garantias,
] as const satisfies readonly SolicitudFieldKey[];

export const FIELD_ACCESS_ALL_GROUPS = [
  ...FIELD_ACCESS_GROUP_ORDER,
  ...LEGACY_EDITABLE_GROUPS,
] as const satisfies readonly SolicitudFieldGroup[];

export const FIELD_ACCESS_BLOCKED_FIELDS = [
  ...BLOCKED_FIELD_KEYS,
] as const;

const FIELD_ACCESS_FIELD_ORDER = new Map<SolicitudFieldKey, number>(
  FIELD_ACCESS_ALL_FIELDS.map((field, index) => [field, index]),
);
const FIELD_ACCESS_GROUP_ORDER_MAP = new Map<SolicitudFieldGroup, number>(
  FIELD_ACCESS_GROUP_ORDER.map((group, index) => [group, index]),
);

export function sortFieldAccessFields(fields: readonly SolicitudFieldKey[]) {
  return [...fields].sort(
    (left, right) =>
      (FIELD_ACCESS_FIELD_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (FIELD_ACCESS_FIELD_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function sortFieldAccessGroups(groups: readonly SolicitudFieldGroup[]) {
  return [...groups].sort(
    (left, right) =>
      (FIELD_ACCESS_GROUP_ORDER_MAP.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (FIELD_ACCESS_GROUP_ORDER_MAP.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function getFieldAccessReadonlyReason() {
  return READONLY_REASON;
}
