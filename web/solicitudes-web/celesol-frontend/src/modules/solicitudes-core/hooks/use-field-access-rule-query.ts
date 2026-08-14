import { useQuery } from "@tanstack/react-query";

import { getFieldAccessRuleByState } from "@/modules/solicitudes-core/services/field-access-admin-api";
import { fieldAccessAdminQueryKeys } from "@/modules/solicitudes-core/services/field-access-admin-query-keys";

export function useFieldAccessRuleQuery(stateCode: string, enabled = true) {
  return useQuery({
    enabled: enabled && stateCode.trim().length > 0,
    queryFn: () => getFieldAccessRuleByState(stateCode),
    queryKey: fieldAccessAdminQueryKeys.rule(stateCode),
    refetchOnWindowFocus: false,
    retry: false,
  });
}
