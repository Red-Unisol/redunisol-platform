import { useQuery } from "@tanstack/react-query";

import { listSolicitudCoreCancelaciones } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useSolicitudCoreCancelacionesQuery(id: string) {
  return useQuery({
    enabled: id.trim().length > 0,
    queryFn: () => listSolicitudCoreCancelaciones(id),
    queryKey: solicitudesCoreQueryKeys.cancelaciones(id),
    retry: false,
  });
}
