import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateSolicitudCoreCancelacion } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import type { UpdateSolicitudCoreCancelacionRequest } from "@/modules/solicitudes/types/solicitudes-core";

export function useUpdateSolicitudCoreCancelacionMutation(solicitudId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      cancelacionId,
      ...payload
    }: { cancelacionId: string } & UpdateSolicitudCoreCancelacionRequest) =>
      updateSolicitudCoreCancelacion(solicitudId, cancelacionId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.cancelaciones(solicitudId),
      });
    },
  });
}
