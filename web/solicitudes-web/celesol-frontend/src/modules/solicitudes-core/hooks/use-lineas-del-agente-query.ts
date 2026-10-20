import { useQuery } from "@tanstack/react-query";

import { getLineasPrestamoByAgente } from "@/modules/solicitudes/services/solicitudes-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

// Lineas del agente del usuario logueado (vendedor o Riesgo, da igual), las
// mismas que ofrece la carga nueva. Las usa el simulador suelto de las listas,
// que no esta atado a una solicitud. Se piden recien al abrirlo.
export function useLineasDelAgenteQuery(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: async () =>
      (await getLineasPrestamoByAgente()).filter(
        (linea) => linea.vigente !== false,
      ),
    queryKey: solicitudesCoreQueryKeys.lineasDelAgente,
    staleTime: 5 * 60 * 1000,
  });
}
