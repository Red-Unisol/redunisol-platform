import { apiClient } from "@/shared/services/http/api-client";

import type {
  VendedorDashboardFilters,
  VendedorDashboardStats,
} from "../types";

export function getDashboardVendedorStats(
  filters: VendedorDashboardFilters,
): Promise<VendedorDashboardStats> {
  const params = new URLSearchParams();
  if (filters.fechaDesde) params.set("fechaDesde", filters.fechaDesde);
  if (filters.fechaHasta) params.set("fechaHasta", filters.fechaHasta);
  if (filters.linea) params.set("linea", filters.linea);

  const qs = params.toString();
  return apiClient.get<VendedorDashboardStats>(
    `/solicitudes/stats/vendedor${qs ? `?${qs}` : ""}`,
  );
}
