import { useQuery } from "@tanstack/react-query";

import { getSociosCancelaciones } from "@/modules/solicitudes/services/solicitudes-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useSociosCancelacionesQuery() {
  return useQuery({
    queryFn: getSociosCancelaciones,
    queryKey: solicitudesCoreQueryKeys.sociosCancelaciones,
    staleTime: Infinity,
  });
}
