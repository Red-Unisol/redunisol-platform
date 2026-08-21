import { useQuery } from "@tanstack/react-query";

import { checkDocumentoDuplicate } from "@/modules/socios/services/socios-api";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";

type UseDocumentoAvailabilityQueryOptions = {
  enabled: boolean;
  excludeSocioId?: string;
  nroDocumento: string;
};

export function useDocumentoAvailabilityQuery({
  enabled,
  excludeSocioId,
  nroDocumento,
}: UseDocumentoAvailabilityQueryOptions) {
  const debouncedNroDocumento = useDebouncedValue(nroDocumento, 400);
  const isDebounced = debouncedNroDocumento === nroDocumento;

  return useQuery({
    enabled: enabled && isDebounced,
    queryFn: () =>
      checkDocumentoDuplicate(debouncedNroDocumento, excludeSocioId),
    queryKey: [
      "socio-documento-availability",
      debouncedNroDocumento,
      excludeSocioId,
    ],
    retry: false,
  });
}
