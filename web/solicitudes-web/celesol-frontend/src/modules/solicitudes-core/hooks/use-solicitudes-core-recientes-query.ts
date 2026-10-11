import { useQuery } from "@tanstack/react-query";

import { listSolicitudesCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import { buildRecientesDateRange } from "@/modules/solicitudes-core/utils/recientes-date-range";

type UseSolicitudesCoreRecientesQueryOptions = {
  vista: "mi-area" | "todas";
  userId?: string;
  workflowOwnerId?: string | null;
  nroDocumento?: string;
  page: number;
  pageSize: number;
};

export function useSolicitudesCoreRecientesQuery({
  vista,
  userId,
  workflowOwnerId,
  nroDocumento,
  page,
  pageSize,
}: UseSolicitudesCoreRecientesQueryOptions) {
  const normalizedDocument = nroDocumento?.trim() || undefined;
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
        nroDocumento: normalizedDocument,
        offset,
        scope: "recientes",
      }),
    queryKey: solicitudesCoreQueryKeys.recientes({
      vista,
      userId,
      workflowOwnerId,
      createdFrom,
      createdTo,
      excludeEstado: "CargaVendedor",
      limit,
      nroDocumento: normalizedDocument,
      offset,
      scope: "recientes",
    }),
    retry: false,
  });
}
