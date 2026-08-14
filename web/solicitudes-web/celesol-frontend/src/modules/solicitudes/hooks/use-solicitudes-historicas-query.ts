import { useQuery } from "@tanstack/react-query";

import {
  getSolicitudesHistoricas,
  SOLICITUDES_HISTORICAS_DEFAULT_MAX,
} from "@/modules/solicitudes/services/solicitudes-api";
import { solicitudesQueryKeys } from "@/modules/solicitudes/services/solicitudes-query-keys";

type UseSolicitudesHistoricasQueryOptions = {
  max?: number;
};

export function useSolicitudesHistoricasQuery(
  options: UseSolicitudesHistoricasQueryOptions = {},
) {
  const max = options.max ?? SOLICITUDES_HISTORICAS_DEFAULT_MAX;

  return useQuery({
    queryFn: () => getSolicitudesHistoricas({ max }),
    queryKey: solicitudesQueryKeys.historicas(max),
    retry: false,
  });
}
