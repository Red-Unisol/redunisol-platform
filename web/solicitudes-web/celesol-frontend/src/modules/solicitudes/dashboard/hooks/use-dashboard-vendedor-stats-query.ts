import { useQuery } from "@tanstack/react-query";

import { getDashboardVendedorStats } from "../services/dashboard-vendedor-api";
import type { VendedorDashboardFilters } from "../types";

export function useDashboardVendedorStatsQuery(
  filters: VendedorDashboardFilters,
) {
  return useQuery({
    queryKey: ["dashboard", "vendedor", "stats", filters],
    queryFn: () => getDashboardVendedorStats(filters),
    refetchOnMount: "always",
    retry: false,
  });
}
