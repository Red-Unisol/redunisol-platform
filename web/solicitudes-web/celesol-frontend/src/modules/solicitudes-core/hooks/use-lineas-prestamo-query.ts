import { useQuery } from "@tanstack/react-query";

import { getLineasPrestamoByAgente } from "@/modules/solicitudes/services/solicitudes-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useLineasPrestamoQuery() {
  return useQuery({
    queryFn: getLineasPrestamoByAgente,
    queryKey: solicitudesCoreQueryKeys.lineasPrestamo,
    staleTime: Infinity,
  });
}
