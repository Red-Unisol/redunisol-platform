import { useQuery } from "@tanstack/react-query";

import {
  getSolicitudesPrecarga,
  SOLICITUDES_PRECARGA_DEFAULT_MAX,
} from "@/modules/solicitudes/services/solicitudes-api";
import { solicitudesQueryKeys } from "@/modules/solicitudes/services/solicitudes-query-keys";

type UseSolicitudesPrecargaQueryOptions = {
  max?: number;
};

export function useSolicitudesPrecargaQuery(
  options: UseSolicitudesPrecargaQueryOptions = {},
) {
  const max = options.max ?? SOLICITUDES_PRECARGA_DEFAULT_MAX;

  return useQuery({
    queryFn: () => getSolicitudesPrecarga({ max }),
    queryKey: solicitudesQueryKeys.precarga(max),
    retry: false,
  });
}
