import { apiClient } from "@/shared/services/http/api-client";

export type WorkflowTransitionAdminOwner = {
  code: string;
  id: string;
  name: string;
};

export type WorkflowTransitionAdminState = {
  code: string;
  id: string;
  name: string;
  owner: WorkflowTransitionAdminOwner;
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
  toState: WorkflowTransitionAdminState;
  updatedAt: string;
};

export type WorkflowTransitionAdminStateGroup = {
  fromState: WorkflowTransitionAdminState;
  transitions: WorkflowTransitionAdminRecord[];
};

export type WorkflowTransitionsListResponse = {
  states: WorkflowTransitionAdminStateGroup[];
};

export type UpdateWorkflowTransitionRequest = {
  actionLabel: string;
  description: string | null;
  sortOrder: number;
  defaultComment: string | null;
  requiresComment: boolean;
  updatedAt: string;
};

export function getWorkflowTransitions() {
  return apiClient.get<WorkflowTransitionsListResponse>(
    "/admin/solicitudes/workflow-transitions",
  );
}

export function getWorkflowTransitionsByState(stateCode: string) {
  return apiClient.get<WorkflowTransitionAdminStateGroup>(
    `/admin/solicitudes/workflow-transitions/${stateCode}`,
  );
}

export function updateWorkflowTransition(
  transitionId: string,
  payload: UpdateWorkflowTransitionRequest,
) {
  return apiClient.put<WorkflowTransitionAdminRecord>(
    `/admin/solicitudes/workflow-transitions/${transitionId}`,
    payload,
  );
}
