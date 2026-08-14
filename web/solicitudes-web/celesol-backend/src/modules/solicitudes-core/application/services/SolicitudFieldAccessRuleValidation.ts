import type {
  SolicitudAppearance,
  SolicitudFieldGroup,
  SolicitudFieldKey,
} from "../../domain/entities/SolicitudCore.entity";
import {
  FieldAccessRuleBlockedFieldError,
  FieldAccessRuleDuplicatedFieldError,
  FieldAccessRuleDuplicatedGroupError,
  FieldAccessRuleInvalidFieldError,
  FieldAccessRuleInvalidAppearanceColorError,
  FieldAccessRuleInvalidGroupError,
} from "../../domain/solicitudes-core-errors";
import {
  FIELD_ACCESS_ALL_FIELDS,
  FIELD_ACCESS_ALL_GROUPS,
  getFieldAccessReadonlyReason,
  sortFieldAccessFields,
  sortFieldAccessGroups,
} from "./SolicitudFieldAccessAdminCatalog";

const FIELD_KEY_SET = new Set<string>(FIELD_ACCESS_ALL_FIELDS);
const GROUP_KEY_SET = new Set<string>(FIELD_ACCESS_ALL_GROUPS);
const HEX_COLOR_REGEX = /^#[0-9A-F]{6}$/;
const BLOCKED_FIELD_KEY_SET = new Set<string>([
  "solicitud.lineaPrestamoLegacyOid",
  "solicitud.ejecutivoSolicitud",
]);

export type NormalizeFieldAccessRuleInput = {
  active?: boolean;
  backgroundColor?: string | null;
  canManageAttachments: boolean;
  editableFields: string[];
  editableGroups: string[];
  readonlyReason?: string | null;
  textColor?: string | null;
};

export type NormalizedFieldAccessRule = {
  active: boolean;
  backgroundColor: SolicitudAppearance["backgroundColor"];
  canManageAttachments: boolean;
  defaultMode: "readonly";
  editableFields: SolicitudFieldKey[];
  editableGroups: SolicitudFieldGroup[];
  readonlyReason: string | null;
  textColor: SolicitudAppearance["textColor"];
};

export function normalizeFieldAccessRule(
  input: NormalizeFieldAccessRuleInput,
): NormalizedFieldAccessRule {
  const duplicatedField = findDuplicate(input.editableFields);
  if (duplicatedField) {
    throw new FieldAccessRuleDuplicatedFieldError();
  }

  const duplicatedGroup = findDuplicate(input.editableGroups);
  if (duplicatedGroup) {
    throw new FieldAccessRuleDuplicatedGroupError();
  }

  const normalizedFields: SolicitudFieldKey[] = [];
  for (const field of input.editableFields) {
    if (BLOCKED_FIELD_KEY_SET.has(field)) {
      throw new FieldAccessRuleBlockedFieldError();
    }

    if (!FIELD_KEY_SET.has(field)) {
      throw new FieldAccessRuleInvalidFieldError();
    }

    normalizedFields.push(field as SolicitudFieldKey);
  }

  const normalizedGroups: SolicitudFieldGroup[] = [];
  for (const group of input.editableGroups) {
    if (!GROUP_KEY_SET.has(group)) {
      throw new FieldAccessRuleInvalidGroupError();
    }

    normalizedGroups.push(group as SolicitudFieldGroup);
  }

  const readonlyReason = input.readonlyReason?.trim() || null;
  const { backgroundColor, textColor } = normalizeAppearance(input);

  return {
    active: input.active ?? true,
    backgroundColor,
    canManageAttachments: input.canManageAttachments,
    defaultMode: "readonly",
    editableFields: sortFieldAccessFields(normalizedFields),
    editableGroups: sortFieldAccessGroups(normalizedGroups),
    readonlyReason:
      normalizedFields.length === 0 && normalizedGroups.length === 0
        ? readonlyReason ?? getFieldAccessReadonlyReason()
        : readonlyReason,
    textColor,
  };
}

function findDuplicate(values: readonly string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return null;
}

function normalizeAppearance(input: NormalizeFieldAccessRuleInput) {
  return {
    backgroundColor: normalizeOptionalColor(input.backgroundColor),
    textColor: normalizeOptionalColor(input.textColor),
  };
}

function normalizeOptionalColor(value: string | null | undefined) {
  const trimmed = value?.trim() || "";

  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.toUpperCase();
  if (!HEX_COLOR_REGEX.test(normalized)) {
    throw new FieldAccessRuleInvalidAppearanceColorError();
  }

  return normalized;
}
