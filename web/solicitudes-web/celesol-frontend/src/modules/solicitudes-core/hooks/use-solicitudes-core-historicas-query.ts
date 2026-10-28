import { useQuery } from "@tanstack/react-query";

import { LISTAS_REFRESCO_AUTOMATICO_MS } from "@/modules/solicitudes-core/utils/list-refresh-state";

import { listSolicitudesCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

type UseSolicitudesCoreHistoricasQueryOptions = {
  search?: string;
  page: number;
  pageSize: number;
};

export function useSolicitudesCoreHistoricasQuery({
  search,
  page,
  pageSize,
}: UseSolicitudesCoreHistoricasQueryOptions) {
  const normalizedSearch = search?.trim() || undefined;
  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  return useQuery({
    queryFn: () =>
      listSolicitudesCore({
        limit,
        search: normalizedSearch,
        offset,
        scope: "historicas",
      }),
    queryKey: solicitudesCoreQueryKeys.historicas({
      limit,
      search: normalizedSearch,
      offset,
    }),
    refetchInterval: LISTAS_REFRESCO_AUTOMATICO_MS,
    retry: false,
  });
}
