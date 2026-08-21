import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteSolicitudCoreCancelacion } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useDeleteSolicitudCoreCancelacionMutation(solicitudId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cancelacionId: string) =>
      deleteSolicitudCoreCancelacion(solicitudId, cancelacionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.cancelaciones(solicitudId),
      });
    },
  });
}
