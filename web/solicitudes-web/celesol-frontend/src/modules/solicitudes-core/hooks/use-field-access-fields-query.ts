import { useQuery } from "@tanstack/react-query";

import { getFieldAccessFields } from "@/modules/solicitudes-core/services/field-access-admin-api";
import { fieldAccessAdminQueryKeys } from "@/modules/solicitudes-core/services/field-access-admin-query-keys";

export function useFieldAccessFieldsQuery() {
  return useQuery({
    queryFn: getFieldAccessFields,
    queryKey: fieldAccessAdminQueryKeys.fields,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
