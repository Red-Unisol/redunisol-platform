import { useQuery } from "@tanstack/react-query";

import { listSolicitudCoreHistory } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useSolicitudCoreHistoryQuery(id: string, enabled = true) {
  return useQuery({
    enabled: enabled && id.trim().length > 0,
    queryFn: () => listSolicitudCoreHistory(id),
    queryKey: solicitudesCoreQueryKeys.history(id),
    retry: false,
  });
}
