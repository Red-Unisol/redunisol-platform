import { useQuery } from "@tanstack/react-query";

import { getSolicitudRefinanciacion } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

// Las cuotas guardadas para refinanciar (base de Sol Web, no Vimarx).
export function useSolicitudRefinanciacionQuery(id: string, enabled: boolean) {
  return useQuery({
    enabled: enabled && id.trim().length > 0,
    queryFn: () => getSolicitudRefinanciacion(id),
    queryKey: solicitudesCoreQueryKeys.refinanciacion(id),
    retry: false,
  });
}
