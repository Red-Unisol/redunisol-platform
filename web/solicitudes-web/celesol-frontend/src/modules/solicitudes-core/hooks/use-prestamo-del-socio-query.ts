import { useQuery } from "@tanstack/react-query";

import { getPrestamoDelSocio } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

// Igual que la lista de prestamos: pega a Vimarx en vivo, asi que se pide solo
// con el modal abierto (prestamoId distinto de null).
export function usePrestamoDelSocioQuery(id: string, prestamoId: string | null) {
  return useQuery({
    enabled: id.trim().length > 0 && prestamoId !== null,
    queryFn: () => getPrestamoDelSocio(id, prestamoId ?? ""),
    queryKey: solicitudesCoreQueryKeys.prestamoDelSocio(id, prestamoId ?? ""),
    retry: false,
  });
}
