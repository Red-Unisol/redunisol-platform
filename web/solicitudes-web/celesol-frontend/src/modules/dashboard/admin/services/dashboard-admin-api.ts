import { apiClient } from "@/shared/services/http/api-client";

import type { DashboardAdminFilters, DashboardAdminStats } from "../types";

export function getDashboardAdminStats(
  filters: DashboardAdminFilters,
): Promise<DashboardAdminStats> {
  const params = new URLSearchParams();
  if (filters.fechaDesde) params.set("fechaDesde", filters.fechaDesde);
  if (filters.fechaHasta) params.set("fechaHasta", filters.fechaHasta);
  if (filters.linea) params.set("linea", filters.linea);
  if (filters.estado) params.set("estado", filters.estado);
  if (filters.area) params.set("area", filters.area);
  if (filters.vendedorId) params.set("vendedorId", filters.vendedorId);
  if (filters.asignadoId) params.set("asignadoId", filters.asignadoId);

  const qs = params.toString();
  return apiClient.get<DashboardAdminStats>(
    `/solicitudes/stats${qs ? `?${qs}` : ""}`,
  );
}
