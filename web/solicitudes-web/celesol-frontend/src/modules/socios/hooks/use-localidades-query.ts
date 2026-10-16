import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { getLocalidades } from "@/modules/socios/services/socios-api";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

const MIN_SEARCH_LENGTH = 2;

// Busca en las localidades de Vimarx; el backend devuelve hasta 50.
export function useLocalidadesSearchQuery(search: string, enabled: boolean) {
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  return useQuery({
    enabled: enabled && debouncedSearch.length >= MIN_SEARCH_LENGTH,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await getLocalidades({ search: debouncedSearch })).items,
    queryKey: ["socio-localidades", "search", debouncedSearch],
    staleTime: Infinity,
  });
}

// La localidad ya cargada (se guarda el id), para mostrar su nombre.
export function useLocalidadQuery(id: string) {
  return useQuery({
    enabled: /^\d+$/.test(id),
    queryFn: async () => (await getLocalidades({ ids: [id] })).items[0] ?? null,
    queryKey: ["socio-localidades", "id", id],
    staleTime: Infinity,
  });
}

export { MIN_SEARCH_LENGTH as LOCALIDAD_MIN_SEARCH_LENGTH };
