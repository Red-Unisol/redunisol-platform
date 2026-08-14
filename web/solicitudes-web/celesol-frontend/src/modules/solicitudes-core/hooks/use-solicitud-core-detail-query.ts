import { useQuery } from "@tanstack/react-query";

import { getSolicitudCoreById } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useSolicitudCoreDetailQuery(id: string) {
  return useQuery({
    enabled: id.trim().length > 0,
    queryFn: () => getSolicitudCoreById(id),
    queryKey: solicitudesCoreQueryKeys.detail(id),
    retry: false,
  });
}
