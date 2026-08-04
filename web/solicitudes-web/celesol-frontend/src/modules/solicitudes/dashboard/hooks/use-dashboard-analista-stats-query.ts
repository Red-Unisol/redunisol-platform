import { useQuery } from "@tanstack/react-query";

import { getDashboardAnalistaStats } from "../services/dashboard-analista-api";
import type { AnalistaDashboardFilters } from "../types";

export function useDashboardAnalistaStatsQuery(
  filters: AnalistaDashboardFilters,
) {
  return useQuery({
    queryKey: ["dashboard", "analista", "stats", filters],
    queryFn: () => getDashboardAnalistaStats(filters),
    refetchOnMount: "always",
    retry: false,
  });
}
