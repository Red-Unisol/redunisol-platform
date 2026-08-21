import { useQuery } from "@tanstack/react-query";

import { listTiposAdjunto } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useTiposAdjuntoQuery() {
  return useQuery({
    queryFn: listTiposAdjunto,
    queryKey: solicitudesCoreQueryKeys.tiposAdjunto,
    staleTime: Infinity,
  });
}
