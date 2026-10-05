import { useQuery } from "@tanstack/react-query";

import { listPrestamosDelSocio } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

// Cada consulta pega a Vimarx en vivo, asi que se pide solo cuando el usuario
// abre la pestaña ("enabled"), no al abrir la solicitud.
export function usePrestamosDelSocioQuery(id: string, enabled: boolean) {
  return useQuery({
    enabled: enabled && id.trim().length > 0,
    queryFn: () => listPrestamosDelSocio(id),
    queryKey: solicitudesCoreQueryKeys.prestamosDelSocio(id),
    retry: false,
  });
}
