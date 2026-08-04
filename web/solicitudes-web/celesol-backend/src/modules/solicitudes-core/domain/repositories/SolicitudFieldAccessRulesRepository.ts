export type SolicitudFieldAccessRuleRecord = {
  workflowStateId: string;
  defaultMode: "readonly";
  editableFields: string[];
  editableGroups: string[];
  canManageAttachments: boolean;
  readonlyReason: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  active: boolean;
};

export type SolicitudFieldAccessRulesRepository = {
  findByWorkflowStateId(
    workflowStateId: string,
  ): Promise<SolicitudFieldAccessRuleRecord | null>;
  findByWorkflowStateIds(
    workflowStateIds: string[],
  ): Promise<SolicitudFieldAccessRuleRecord[]>;
};
