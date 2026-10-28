import { useQuery } from "@tanstack/react-query";

import { LISTAS_REFRESCO_AUTOMATICO_MS } from "@/modules/solicitudes-core/utils/list-refresh-state";

import { listSolicitudesCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

type UseSolicitudesCorePrecargaQueryOptions = {
  search?: string;
  page: number;
  pageSize: number;
};

export function useSolicitudesCorePrecargaQuery({
  search,
  page,
  pageSize,
}: UseSolicitudesCorePrecargaQueryOptions) {
  const normalizedSearch = search?.trim() || undefined;
  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  return useQuery({
    queryFn: () =>
      listSolicitudesCore({
        estado: "CargaVendedor",
        limit,
        search: normalizedSearch,
        offset,
      }),
    queryKey: solicitudesCoreQueryKeys.precarga({
      limit,
      search: normalizedSearch,
      offset,
    }),
    refetchInterval: LISTAS_REFRESCO_AUTOMATICO_MS,
    retry: false,
  });
}
