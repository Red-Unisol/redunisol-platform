import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  type UpdateWorkflowTransitionRequest,
  updateWorkflowTransition,
} from "@/modules/solicitudes-core/services/workflow-transition-admin-api";
import { workflowTransitionAdminQueryKeys } from "@/modules/solicitudes-core/services/workflow-transition-admin-query-keys";

export function useWorkflowTransitionRuleUpdateMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      payload,
      transitionId,
    }: {
      payload: UpdateWorkflowTransitionRequest;
      transitionId: string;
    }) => updateWorkflowTransition(transitionId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workflowTransitionAdminQueryKeys.states,
      });
    },
  });
}
