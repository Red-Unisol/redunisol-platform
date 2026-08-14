import { useQuery } from "@tanstack/react-query";

import { getDashboardAdminStats } from "../services/dashboard-admin-api";
import type { DashboardAdminFilters } from "../types";

export function useDashboardAdminStatsQuery(filters: DashboardAdminFilters) {
  return useQuery({
    queryKey: ["dashboard", "admin", "stats", filters],
    queryFn: () => getDashboardAdminStats(filters),
    refetchOnMount: "always",
    retry: false,
  });
}
