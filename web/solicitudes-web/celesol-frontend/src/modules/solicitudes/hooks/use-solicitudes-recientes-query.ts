import { useQuery } from "@tanstack/react-query";

import {
  getSolicitudesRecientes,
  SOLICITUDES_RECIENTES_DEFAULT_MAX,
} from "@/modules/solicitudes/services/solicitudes-api";
import { solicitudesQueryKeys } from "@/modules/solicitudes/services/solicitudes-query-keys";

type UseSolicitudesRecientesQueryOptions = {
  max?: number;
};

export function useSolicitudesRecientesQuery(
  options: UseSolicitudesRecientesQueryOptions = {},
) {
  const max = options.max ?? SOLICITUDES_RECIENTES_DEFAULT_MAX;

  return useQuery({
    queryFn: () => getSolicitudesRecientes({ max }),
    queryKey: solicitudesQueryKeys.recientes(max),
    retry: false,
  });
}
