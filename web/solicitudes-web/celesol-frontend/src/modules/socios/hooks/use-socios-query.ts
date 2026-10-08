import { useQuery } from "@tanstack/react-query";

import { getSocios } from "@/modules/socios/services/socios-api";

type UseSociosQueryOptions = {
  enabled?: boolean;
  page: number;
  pageSize: number;
  search?: string;
};

export function useSociosQuery({
  enabled = true,
  page,
  pageSize,
  search,
}: UseSociosQueryOptions) {
  const normalizedSearch = search?.trim() || undefined;
  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  return useQuery({
    enabled,
    queryFn: () => getSocios({ limit, offset, search: normalizedSearch }),
    queryKey: ["socios", { limit, offset, search: normalizedSearch }],
    retry: false,
  });
}
