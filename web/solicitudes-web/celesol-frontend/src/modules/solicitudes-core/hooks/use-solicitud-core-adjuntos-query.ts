import { useQuery } from "@tanstack/react-query";

import { listSolicitudCoreAdjuntos } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useSolicitudCoreAdjuntosQuery(id: string) {
  return useQuery({
    enabled: id.trim().length > 0,
    queryFn: () => listSolicitudCoreAdjuntos(id),
    queryKey: solicitudesCoreQueryKeys.adjuntos(id),
    retry: false,
  });
}
