import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  updateFieldAccessRule,
  type UpdateFieldAccessRuleRequest,
} from "@/modules/solicitudes-core/services/field-access-admin-api";
import { fieldAccessAdminQueryKeys } from "@/modules/solicitudes-core/services/field-access-admin-query-keys";

export function useFieldAccessRuleUpdateMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      payload,
      stateCode,
    }: {
      payload: UpdateFieldAccessRuleRequest;
      stateCode: string;
    }) => updateFieldAccessRule(stateCode, payload),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: fieldAccessAdminQueryKeys.rules,
        }),
        queryClient.invalidateQueries({
          queryKey: fieldAccessAdminQueryKeys.rule(variables.stateCode),
        }),
      ]);
    },
  });
}
