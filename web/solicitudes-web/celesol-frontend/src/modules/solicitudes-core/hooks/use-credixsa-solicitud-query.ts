import { useQuery } from "@tanstack/react-query";

import { getCredixsaSolicitud } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

// Se pide solo al abrir la pestaña. Si la solicitud ya disparo la consulta al
// crearse, el informe viene de la cache y responde al instante; si no, el
// backend espera el scraping de CredixSA (hasta 90 segundos).
export function useCredixsaSolicitudQuery(id: string, enabled: boolean) {
  return useQuery({
    enabled: enabled && id.trim().length > 0,
    queryFn: () => getCredixsaSolicitud(id),
    queryKey: solicitudesCoreQueryKeys.credixsa(id),
    retry: false,
    // El informe vale 7 dias en la cache de Kestra: no tiene sentido volver a
    // pedirlo por cambiar de pestaña.
    staleTime: 5 * 60 * 1000,
  });
}
