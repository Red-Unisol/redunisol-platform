import { useQuery } from "@tanstack/react-query";

import { getWorkflowTransitions } from "@/modules/solicitudes-core/services/workflow-transition-admin-api";
import { workflowTransitionAdminQueryKeys } from "@/modules/solicitudes-core/services/workflow-transition-admin-query-keys";

export function useWorkflowTransitionRulesQuery() {
  return useQuery({
    queryFn: getWorkflowTransitions,
    queryKey: workflowTransitionAdminQueryKeys.states,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
