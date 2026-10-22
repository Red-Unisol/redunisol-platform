import { useQuery } from "@tanstack/react-query";

import { LISTAS_REFRESCO_AUTOMATICO_MS } from "@/modules/solicitudes-core/utils/list-refresh-state";

import { listSolicitudesCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

type UseSolicitudesCorePrecargaQueryOptions = {
  nroDocumento?: string;
  page: number;
  pageSize: number;
};

export function useSolicitudesCorePrecargaQuery({
  nroDocumento,
  page,
  pageSize,
}: UseSolicitudesCorePrecargaQueryOptions) {
  const normalizedDocument = nroDocumento?.trim() || undefined;
  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  return useQuery({
    queryFn: () =>
      listSolicitudesCore({
        estado: "CargaVendedor",
        limit,
        nroDocumento: normalizedDocument,
        offset,
      }),
    queryKey: solicitudesCoreQueryKeys.precarga({
      limit,
      nroDocumento: normalizedDocument,
      offset,
    }),
    refetchInterval: LISTAS_REFRESCO_AUTOMATICO_MS,
    retry: false,
  });
}
