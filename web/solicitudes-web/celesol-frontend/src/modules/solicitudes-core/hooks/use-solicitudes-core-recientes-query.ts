import { useQuery } from "@tanstack/react-query";

import { listSolicitudesCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import { buildRecientesDateRange } from "@/modules/solicitudes-core/utils/recientes-date-range";

type UseSolicitudesCoreRecientesQueryOptions = {
  nroDocumento?: string;
  page: number;
  pageSize: number;
};

export function useSolicitudesCoreRecientesQuery({
  nroDocumento,
  page,
  pageSize,
}: UseSolicitudesCoreRecientesQueryOptions) {
  const normalizedDocument = nroDocumento?.trim() || undefined;
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const { createdFrom, createdTo } = buildRecientesDateRange();

  return useQuery({
    queryFn: () =>
      listSolicitudesCore({
        createdFrom,
        createdTo,
        excludeEstado: "CargaVendedor",
        limit,
        nroDocumento: normalizedDocument,
        offset,
        scope: "recientes",
      }),
    queryKey: solicitudesCoreQueryKeys.recientes({
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
