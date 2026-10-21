import { useQuery } from "@tanstack/react-query";

import { recientesRefreshOptions } from "../utils/recientes-refresh-options";
import type { RecientesView } from "../utils/recientes-view";

import { listSolicitudesCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import { buildRecientesDateRange } from "@/modules/solicitudes-core/utils/recientes-date-range";

type UseSolicitudesCoreRecientesQueryOptions = {
  vista: RecientesView;
  userId?: string;
  isSystemAdmin?: boolean;
  workflowOwnerId?: string | null;
  search?: string;
  page: number;
  pageSize: number;
};

export function useSolicitudesCoreRecientesQuery({
  vista,
  userId,
  isSystemAdmin,
  workflowOwnerId,
  search,
  page,
  pageSize,
}: UseSolicitudesCoreRecientesQueryOptions) {
  const normalizedSearch = search?.trim().replace(/\s+/g, " ") || undefined;
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const { createdFrom, createdTo } = buildRecientesDateRange();

  return useQuery({
    enabled: Boolean(userId),
    queryFn: () =>
      listSolicitudesCore({
        vista,
        createdFrom,
        createdTo,
        excludeEstado: "CargaVendedor",
        limit,
        search: normalizedSearch,
        offset,
        scope: "recientes",
      }),
    queryKey: solicitudesCoreQueryKeys.recientes({
      vista,
      userId,
      isSystemAdmin,
      workflowOwnerId,
      createdFrom,
      createdTo,
      excludeEstado: "CargaVendedor",
      limit,
      search: normalizedSearch,
      offset,
      scope: "recientes",
    }),
    ...recientesRefreshOptions,
  });
}
