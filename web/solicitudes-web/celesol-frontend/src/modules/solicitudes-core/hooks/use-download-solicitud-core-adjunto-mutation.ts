import { useMutation } from "@tanstack/react-query";

import { downloadSolicitudCoreAdjunto } from "@/modules/solicitudes-core/services/solicitudes-core-api";

export function useDownloadSolicitudCoreAdjuntoMutation(solicitudId: string) {
  return useMutation({
    mutationFn: (adjuntoId: string) =>
      downloadSolicitudCoreAdjunto(solicitudId, adjuntoId),
  });
}
