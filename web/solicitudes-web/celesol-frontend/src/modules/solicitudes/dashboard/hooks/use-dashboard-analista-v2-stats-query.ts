import { useQuery } from "@tanstack/react-query";

import { getDashboardAnalistaV2Stats } from "../services/dashboard-analista-v2-api";
import type { AnalistaDashboardFilters } from "../types";

export function useDashboardAnalistaV2StatsQuery(
  filters: AnalistaDashboardFilters,
) {
  return useQuery({
    queryKey: ["dashboard", "analista-v2", "stats", filters],
    queryFn: () => getDashboardAnalistaV2Stats(filters),
    refetchOnMount: "always",
    retry: false,
  });
}
