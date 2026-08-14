import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patchSolicitudCoreAdjunto } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import type { PatchSolicitudCoreAdjuntoRequest } from "@/modules/solicitudes/types/solicitudes-core";

export function usePatchSolicitudCoreAdjuntoMutation(solicitudId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      adjuntoId,
      ...payload
    }: { adjuntoId: string } & PatchSolicitudCoreAdjuntoRequest) =>
      patchSolicitudCoreAdjunto(solicitudId, adjuntoId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.adjuntos(solicitudId),
      });
    },
  });
}
