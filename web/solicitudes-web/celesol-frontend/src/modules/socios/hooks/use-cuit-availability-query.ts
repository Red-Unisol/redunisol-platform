import { useQuery } from "@tanstack/react-query";

import { checkCuitDuplicate } from "@/modules/socios/services/socios-api";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

type UseCuitAvailabilityQueryOptions = {
  cuit: string;
  enabled: boolean;
  excludeSocioId?: string;
};

export function useCuitAvailabilityQuery({
  cuit,
  enabled,
  excludeSocioId,
}: UseCuitAvailabilityQueryOptions) {
  const debouncedCuit = useDebouncedValue(cuit, 400);
  const isDebounced = debouncedCuit === cuit;

  return useQuery({
    enabled: enabled && isDebounced,
    queryFn: () => checkCuitDuplicate(debouncedCuit, excludeSocioId),
    queryKey: ["socio-cuit-availability", debouncedCuit, excludeSocioId],
    retry: false,
  });
}
