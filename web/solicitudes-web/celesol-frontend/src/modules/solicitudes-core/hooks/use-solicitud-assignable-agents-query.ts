import { useQuery } from "@tanstack/react-query";

import { listSolicitudAssignableAgents } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useSolicitudAssignableAgentsQuery(
  solicitudId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    enabled: (options?.enabled ?? true) && solicitudId.trim().length > 0,
    queryFn: () => listSolicitudAssignableAgents(solicitudId),
    queryKey: solicitudesCoreQueryKeys.assignmentAgents(solicitudId),
  });
}
