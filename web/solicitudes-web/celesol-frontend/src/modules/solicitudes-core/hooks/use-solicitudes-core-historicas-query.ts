import { useQuery } from "@tanstack/react-query";

import { listSolicitudesCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

type UseSolicitudesCoreHistoricasQueryOptions = {
  nroDocumento?: string;
  page: number;
  pageSize: number;
};

export function useSolicitudesCoreHistoricasQuery({
  nroDocumento,
  page,
  pageSize,
}: UseSolicitudesCoreHistoricasQueryOptions) {
  const normalizedDocument = nroDocumento?.trim() || undefined;
  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  return useQuery({
    queryFn: () =>
      listSolicitudesCore({
        limit,
        nroDocumento: normalizedDocument,
        offset,
        scope: "historicas",
      }),
    queryKey: solicitudesCoreQueryKeys.historicas({
      limit,
      nroDocumento: normalizedDocument,
      offset,
    }),
    retry: false,
  });
}
