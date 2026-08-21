import { apiClient } from "@/shared/services/http/api-client";

import type {
  AnalistaDashboardFilters,
  AnalistaDashboardStatsV2,
} from "../types";

export function getDashboardAnalistaV2Stats(
  filters: AnalistaDashboardFilters,
): Promise<AnalistaDashboardStatsV2> {
  const params = new URLSearchParams();
  if (filters.fechaDesde) params.set("fechaDesde", filters.fechaDesde);
  if (filters.fechaHasta) params.set("fechaHasta", filters.fechaHasta);
  if (filters.linea) params.set("linea", filters.linea);
  if (filters.estado) params.set("estado", filters.estado);
  if (filters.vendedorId) params.set("vendedorId", filters.vendedorId);
  if (filters.vista) params.set("vista", filters.vista);
  if (filters.conRetrabajo) params.set("conRetrabajo", filters.conRetrabajo);
  if (filters.umbralDias) params.set("umbralDias", String(filters.umbralDias));

  const qs = params.toString();
  return apiClient.get<AnalistaDashboardStatsV2>(
    `/solicitudes/stats/analista/v2${qs ? `?${qs}` : ""}`,
  );
}
