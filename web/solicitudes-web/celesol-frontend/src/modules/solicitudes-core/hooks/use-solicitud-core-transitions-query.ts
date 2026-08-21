import { useQuery } from "@tanstack/react-query";

import { listSolicitudCoreTransitions } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

type UseSolicitudCoreTransitionsQueryOptions = {
  enabled?: boolean;
};

export function useSolicitudCoreTransitionsQuery(
  id: string,
  options: UseSolicitudCoreTransitionsQueryOptions = {},
) {
  const { enabled = true } = options;

  return useQuery({
    enabled: enabled && id.trim().length > 0,
    queryFn: () => listSolicitudCoreTransitions(id),
    queryKey: solicitudesCoreQueryKeys.transitions(id),
    retry: false,
  });
}
