import { useQuery } from "@tanstack/react-query";

import { LISTAS_REFRESCO_AUTOMATICO_MS } from "@/modules/solicitudes-core/utils/list-refresh-state";

import { listSolicitudesCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import { buildRecientesDateRange } from "@/modules/solicitudes-core/utils/recientes-date-range";

export type VistaRecientes = "mi-area" | "todas" | "verificar-firma";

// La vista "verificar-firma" es la de todas las areas, limitada a ese estado.
const ESTADO_VERIFICAR_FIRMA = "VerificarFirmaYDocumentacion";

type UseSolicitudesCoreRecientesQueryOptions = {
  vista: VistaRecientes;
  userId?: string;
  workflowOwnerIds?: string[];
  search?: string;
  page: number;
  pageSize: number;
};

export function useSolicitudesCoreRecientesQuery({
  vista,
  userId,
  workflowOwnerIds,
  search,
  page,
  pageSize,
}: UseSolicitudesCoreRecientesQueryOptions) {
  const normalizedSearch = search?.trim().replace(/\s+/g, " ") || undefined;
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const { createdFrom, createdTo } = buildRecientesDateRange();
  const vistaApi = vista === "verificar-firma" ? "todas" : vista;
  const estado = vista === "verificar-firma" ? ESTADO_VERIFICAR_FIRMA : undefined;

  return useQuery({
    enabled: Boolean(userId),
    queryFn: () =>
      listSolicitudesCore({
        vista: vistaApi,
        estado,
        createdFrom,
        createdTo,
        excludeEstado: "CargaVendedor",
        limit,
        search: normalizedSearch,
        offset,
        scope: "recientes",
      }),
    queryKey: solicitudesCoreQueryKeys.recientes({
      vista: vistaApi,
      estado,
      userId,
      workflowOwnerIds,
      createdFrom,
      createdTo,
      excludeEstado: "CargaVendedor",
      limit,
      search: normalizedSearch,
      offset,
      scope: "recientes",
    }),
    refetchInterval: LISTAS_REFRESCO_AUTOMATICO_MS,
    retry: false,
  });
}
