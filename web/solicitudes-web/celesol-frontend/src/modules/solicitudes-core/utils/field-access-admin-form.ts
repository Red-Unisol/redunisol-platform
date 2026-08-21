import { ApiError } from "@/shared/services/http/api-error";

import type {
  FieldAccessFieldsResponse,
  FieldAccessRuleDetailResponse,
  UpdateFieldAccessRuleRequest,
} from "@/modules/solicitudes-core/services/field-access-admin-api";
import {
  getFieldAccessFieldLabel,
  getFieldAccessGroupLabel,
} from "@/modules/solicitudes-core/utils/field-access-admin-labels";

export type FieldAccessAdminIssueCode =
  | "blocked_field"
  | "duplicated_field"
  | "duplicated_group"
  | "invalid_field"
  | "invalid_group";

export type FieldAccessBackendErrorCode =
  | "FIELD_ACCESS_RULE_INVALID_FIELD"
  | "FIELD_ACCESS_RULE_INVALID_GROUP"
  | "FIELD_ACCESS_RULE_BLOCKED_FIELD"
  | "FIELD_ACCESS_RULE_DUPLICATED_FIELD"
  | "FIELD_ACCESS_RULE_DUPLICATED_GROUP"
  | "FIELD_ACCESS_RULE_INVALID_APPEARANCE_COLOR"
  | "FIELD_ACCESS_RULE_STATE_NOT_FOUND"
  | "FIELD_ACCESS_RULE_VERSION_CONFLICT";

export type FieldAccessRuleDraft = {
  active: boolean;
  backgroundColor: string;
  canManageAttachments: boolean;
  editableFields: string[];
  editableGroups: string[];
  readonlyReason: string;
  stateCode: string;
  textColor: string;
  version: number;
};

export type FieldAccessAdminValidationIssue = {
  code: FieldAccessAdminIssueCode;
  message: string;
  value: string;
};

type PersistedFieldAccessAppearance = {
  backgroundColor: string | null;
  textColor: string | null;
};

export function createFieldAccessRuleDraft(
  detail: FieldAccessRuleDetailResponse,
  catalog?: FieldAccessFieldsResponse,
): FieldAccessRuleDraft {
  const editableFields = [...(detail.rule?.editableFields ?? [])];
  const editableGroups = [...(detail.rule?.editableGroups ?? [])];

  if (catalog && editableGroups.includes("garantias")) {
    catalog.fieldCatalog.garantias.forEach((field) => {
      if (!editableFields.includes(field)) {
        editableFields.push(field);
      }
    });
  }

  return {
    active: detail.rule?.active ?? true,
    backgroundColor: detail.rule?.backgroundColor ?? "",
    canManageAttachments: detail.rule?.canManageAttachments ?? false,
    editableFields,
    editableGroups: editableGroups.filter((group) => group !== "garantias"),
    readonlyReason: detail.rule?.readonlyReason ?? "",
    stateCode: detail.state.code,
    textColor: detail.rule?.textColor ?? "",
    version: detail.rule?.version ?? 0,
  };
}

export function toggleDraftValue(values: readonly string[], value: string) {
  if (values.includes(value)) {
    return values.filter((current) => current !== value);
  }

  return [...values, value];
}

export function removeDraftValue(values: readonly string[], value: string) {
  return values.filter((current) => current !== value);
}

export function validateFieldAccessRuleDraft(
  draft: FieldAccessRuleDraft,
  catalog: FieldAccessFieldsResponse,
) {
  const issues: FieldAccessAdminValidationIssue[] = [];
  const fieldSet = new Set(flattenFieldCatalog(catalog));
  const groupSet = new Set(catalog.groupCatalog);
  const blockedSet = new Set(catalog.blockedFields);

  for (const duplicatedField of collectDuplicates(draft.editableFields)) {
    issues.push({
      code: "duplicated_field",
      message: `El campo ${getFieldAccessFieldLabel(duplicatedField)} está repetido.`,
      value: duplicatedField,
    });
  }

  for (const duplicatedGroup of collectDuplicates(draft.editableGroups)) {
    issues.push({
      code: "duplicated_group",
      message: `La sección ${getFieldAccessGroupLabel(duplicatedGroup)} está repetida.`,
      value: duplicatedGroup,
    });
  }

  for (const field of draft.editableFields) {
    if (blockedSet.has(field)) {
      issues.push({
        code: "blocked_field",
        message: `${getFieldAccessFieldLabel(field)} es un dato protegido y no se puede habilitar.`,
        value: field,
      });
      continue;
    }

    if (!fieldSet.has(field)) {
      issues.push({
        code: "invalid_field",
        message: `${getFieldAccessFieldLabel(field)} no forma parte de los datos configurables.`,
        value: field,
      });
    }
  }

  for (const group of draft.editableGroups) {
    if (!groupSet.has(group)) {
      issues.push({
        code: "invalid_group",
        message: `${getFieldAccessGroupLabel(group)} no forma parte de las secciones configurables.`,
        value: group,
      });
    }
  }

  return dedupeIssues(issues);
}

export function buildFieldAccessRuleUpdatePayload(
  draft: FieldAccessRuleDraft,
  catalog: FieldAccessFieldsResponse,
  initialAppearance: PersistedFieldAccessAppearance,
): UpdateFieldAccessRuleRequest {
  const payload: UpdateFieldAccessRuleRequest = {
    active: draft.active,
    canManageAttachments: draft.canManageAttachments,
    editableFields: sortFields(draft.editableFields, catalog),
    editableGroups: sortGroups(draft.editableGroups, catalog),
    readonlyReason: normalizeReadonlyReason(draft.readonlyReason),
    version: draft.version,
  };

  const nextBackgroundColor = normalizeOptionalColor(draft.backgroundColor);
  const nextTextColor = normalizeOptionalColor(draft.textColor);

  if (nextBackgroundColor !== initialAppearance.backgroundColor) {
    payload.backgroundColor = nextBackgroundColor;
  }

  if (nextTextColor !== initialAppearance.textColor) {
    payload.textColor = nextTextColor;
  }

  return payload;
}

export function getFieldAccessAdminErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "No se pudo completar la acción.";
  }

  switch (error.message as FieldAccessBackendErrorCode) {
    case "FIELD_ACCESS_RULE_INVALID_APPEARANCE_COLOR":
      return "Los colores deben usar formato hexadecimal #RRGGBB.";
    case "FIELD_ACCESS_RULE_INVALID_FIELD":
      return "La configuración incluye un campo que ya no está disponible.";
    case "FIELD_ACCESS_RULE_INVALID_GROUP":
      return "La configuración incluye una sección que ya no está disponible.";
    case "FIELD_ACCESS_RULE_BLOCKED_FIELD":
      return "La configuración incluye un dato protegido y no se puede habilitar.";
    case "FIELD_ACCESS_RULE_DUPLICATED_FIELD":
      return "La configuración tiene campos repetidos.";
    case "FIELD_ACCESS_RULE_DUPLICATED_GROUP":
      return "La configuración tiene secciones repetidas.";
    case "FIELD_ACCESS_RULE_STATE_NOT_FOUND":
      return "El estado seleccionado ya no existe. Recarga la pantalla.";
    case "FIELD_ACCESS_RULE_VERSION_CONFLICT":
      return "Otra persona modificó esta configuración mientras la estabas editando. Recarga la regla antes de guardar nuevamente.";
    default:
      if (error.status === 403) {
        return "No tenés permisos para administrar estos permisos de edición.";
      }

      return error.message || "No se pudo completar la acción.";
  }
}

function flattenFieldCatalog(catalog: FieldAccessFieldsResponse) {
  return [
    ...catalog.fieldCatalog.solicitud,
    ...catalog.fieldCatalog.titular,
    ...catalog.fieldCatalog.conyuge,
    ...catalog.fieldCatalog.datosLaborales,
    ...catalog.fieldCatalog.garantias,
  ];
}

function collectDuplicates(values: readonly string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return [...duplicates];
}

function dedupeIssues(issues: FieldAccessAdminValidationIssue[]) {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.value}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sortFields(
  fields: readonly string[],
  catalog: FieldAccessFieldsResponse,
) {
  const order = new Map(
    flattenFieldCatalog(catalog).map((field, index) => [field, index]),
  );

  return [...fields].sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

function sortGroups(
  groups: readonly string[],
  catalog: FieldAccessFieldsResponse,
) {
  const order = new Map(
    catalog.groupCatalog.map((group, index) => [group, index]),
  );

  return [...groups].sort(
    (left, right) =>
      (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

function normalizeReadonlyReason(readonlyReason: string) {
  const trimmed = readonlyReason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalColor(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}
