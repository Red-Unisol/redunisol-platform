export type WorkflowTransitionAdminStateRecord = {
  code: string;
  id: string;
  name: string;
  owner: {
    code: string;
    id: string;
    name: string;
  };
};

export type WorkflowTransitionAdminRecord = {
  actionCode: string;
  actionLabel: string;
  defaultComment: string | null;
  description: string | null;
  id: string;
  isActive: boolean;
  requiresComment: boolean;
  sortOrder: number;
  toState: WorkflowTransitionAdminStateRecord;
  updatedAt: Date;
};

export type WorkflowTransitionAdminStateGroup = {
  fromState: WorkflowTransitionAdminStateRecord;
  transitions: WorkflowTransitionAdminRecord[];
};

export type UpdateWorkflowTransitionMetadataInput = {
  actionLabel: string;
  defaultComment: string | null;
  description: string | null;
  requiresComment: boolean;
  sortOrder: number;
  transitionId: string;
  updatedAt: string;
  updatedBy: string;
};

export type WorkflowTransitionAdminRepository = {
  findAllStateGroups(): Promise<WorkflowTransitionAdminStateGroup[]>;
  findStateGroupByCode(
    stateCode: string,
  ): Promise<WorkflowTransitionAdminStateGroup | null>;
  updateTransitionMetadata(
    input: UpdateWorkflowTransitionMetadataInput,
  ): Promise<WorkflowTransitionAdminRecord>;
};
