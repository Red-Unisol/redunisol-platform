import { useQuery } from "@tanstack/react-query";

import { getSolicitudCoreLineasPrestamo } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

// Lineas que se le pueden asignar a la solicitud (las del agente de su
// vendedor). Las usan el cambio de linea y el simulador del detalle.
export function useLineasPrestamoQuery(solicitudId: string) {
  return useQuery({
    enabled: Boolean(solicitudId),
    queryFn: () => getSolicitudCoreLineasPrestamo(solicitudId),
    queryKey: solicitudesCoreQueryKeys.lineasPrestamo(solicitudId),
    staleTime: Infinity,
  });
}
