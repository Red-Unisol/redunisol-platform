import { useQuery } from "@tanstack/react-query";

import { getFieldAccessRules } from "@/modules/solicitudes-core/services/field-access-admin-api";
import { fieldAccessAdminQueryKeys } from "@/modules/solicitudes-core/services/field-access-admin-query-keys";

export function useFieldAccessRulesQuery() {
  return useQuery({
    queryFn: getFieldAccessRules,
    queryKey: fieldAccessAdminQueryKeys.rules,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
