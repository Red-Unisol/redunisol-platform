import type {
  SolicitudCoreAppearance,
  SolicitudFieldAccessResponse,
} from "@/modules/solicitudes/types/solicitudes-core";
import { apiClient } from "@/shared/services/http/api-client";

export type FieldAccessAdminRuleSource =
  | "persisted"
  | "fallback_missing"
  | "fallback_inactive"
  | "fallback_invalid";

export type FieldAccessAdminState = {
  code: string;
  id: string;
  isActive: boolean;
  isInitial: boolean;
  isTerminal: boolean;
  name: string;
  ownerCode: string;
  ownerId: string;
  ownerName: string;
};

export type FieldAccessAdminRule = {
  active: boolean;
  backgroundColor: string | null;
  canManageAttachments: boolean;
  defaultMode: "readonly";
  editableFields: string[];
  editableGroups: string[];
  readonlyReason: string | null;
  textColor: string | null;
  updatedAt: string;
  updatedBy: string | null;
  version: number;
  workflowStateId: string;
};

export type FieldAccessRulesListItem = {
  resolvedAppearance: SolicitudCoreAppearance;
  resolvedFieldAccess: SolicitudFieldAccessResponse;
  rule: FieldAccessAdminRule | null;
  source: FieldAccessAdminRuleSource;
  state: FieldAccessAdminState;
};

export type FieldAccessRulesListResponse = {
  rules: FieldAccessRulesListItem[];
};

export type FieldAccessRuleDetailResponse = {
  resolvedAppearance: SolicitudCoreAppearance;
  resolvedFieldAccess: SolicitudFieldAccessResponse;
  rule: FieldAccessAdminRule | null;
  source: FieldAccessAdminRuleSource;
  state: FieldAccessAdminState;
};

export type FieldAccessFieldsResponse = {
  allowedDefaultModes: ["readonly"];
  blockedFields: string[];
  defaultReadonlyReason: string;
  fieldCatalog: {
    conyuge: string[];
    datosLaborales: string[];
    garantias: string[];
    solicitud: string[];
    titular: string[];
  };
  groupCatalog: string[];
  states: FieldAccessAdminState[];
};

export type UpdateFieldAccessRuleRequest = {
  active: boolean;
  backgroundColor?: string | null;
  canManageAttachments: boolean;
  editableFields: string[];
  editableGroups: string[];
  readonlyReason?: string | null;
  textColor?: string | null;
  version: number;
};

export type UpdateFieldAccessRuleResponse = {
  resolvedAppearance: SolicitudCoreAppearance;
  resolvedFieldAccess: SolicitudFieldAccessResponse;
  rule: FieldAccessAdminRule;
  state: {
    code: string;
    id: string;
    name: string;
  };
};

export function getFieldAccessRules() {
  return apiClient.get<FieldAccessRulesListResponse>(
    "/admin/solicitudes/field-access-rules",
  );
}

export function getFieldAccessRuleByState(stateCode: string) {
  return apiClient.get<FieldAccessRuleDetailResponse>(
    `/admin/solicitudes/field-access-rules/${stateCode}`,
  );
}

export function getFieldAccessFields() {
  return apiClient.get<FieldAccessFieldsResponse>(
    "/admin/solicitudes/field-access-fields",
  );
}

export function updateFieldAccessRule(
  stateCode: string,
  payload: UpdateFieldAccessRuleRequest,
) {
  return apiClient.put<UpdateFieldAccessRuleResponse>(
    `/admin/solicitudes/field-access-rules/${stateCode}`,
    payload,
  );
}
