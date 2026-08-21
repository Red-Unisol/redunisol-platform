import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteSolicitudCoreAdjunto } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useDeleteSolicitudCoreAdjuntoMutation(solicitudId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (adjuntoId: string) =>
      deleteSolicitudCoreAdjunto(solicitudId, adjuntoId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.adjuntos(solicitudId),
      });
    },
  });
}
