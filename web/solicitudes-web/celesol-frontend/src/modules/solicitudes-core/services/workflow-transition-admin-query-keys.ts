const workflowTransitionAdminRootKey = [
  "solicitudes-core",
  "workflow-transition-admin",
] as const;

export const workflowTransitionAdminQueryKeys = {
  all: workflowTransitionAdminRootKey,
  state: (stateCode: string) =>
    [...workflowTransitionAdminRootKey, "state", stateCode] as const,
  states: [...workflowTransitionAdminRootKey, "states"] as const,
};
