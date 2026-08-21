import type {
  SolicitudAppearance,
  SolicitudFieldAccess,
  SolicitudFieldGroup,
  SolicitudFieldKey,
} from "../entities/SolicitudCore.entity";

export type FieldAccessRuleSource =
  | "persisted"
  | "fallback_missing"
  | "fallback_inactive"
  | "fallback_invalid";

export type WorkflowStateAdminRecord = {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  ownerCode: string;
  ownerName: string;
  isInitial: boolean;
  isTerminal: boolean;
  isActive: boolean;
};

export type SolicitudFieldAccessAdminRuleRecord = {
  workflowStateId: string;
  defaultMode: "readonly";
  editableFields: string[];
  editableGroups: string[];
  canManageAttachments: boolean;
  readonlyReason: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  active: boolean;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
};

export type SolicitudFieldAccessAdminRuleView = {
  state: WorkflowStateAdminRecord;
  rule: SolicitudFieldAccessAdminRuleRecord | null;
  resolvedFieldAccess: SolicitudFieldAccess;
  resolvedAppearance: SolicitudAppearance;
  source: FieldAccessRuleSource;
};

export type PersistSolicitudFieldAccessRuleInput = {
  workflowStateId: string;
  expectedVersion: number;
  nextRule: {
    defaultMode: "readonly";
    editableFields: SolicitudFieldKey[];
    editableGroups: SolicitudFieldGroup[];
    canManageAttachments: boolean;
    readonlyReason: string | null;
    backgroundColor: string | null;
    textColor: string | null;
    active: boolean;
  };
  updatedBy: string;
};

export type SolicitudFieldAccessAdminRepository = {
  findAllStates(): Promise<WorkflowStateAdminRecord[]>;
  findStateByCode(stateCode: string): Promise<WorkflowStateAdminRecord | null>;
  findRuleByWorkflowStateId(
    workflowStateId: string,
  ): Promise<SolicitudFieldAccessAdminRuleRecord | null>;
  saveRuleWithAudit(
    input: PersistSolicitudFieldAccessRuleInput,
  ): Promise<SolicitudFieldAccessAdminRuleRecord>;
};
