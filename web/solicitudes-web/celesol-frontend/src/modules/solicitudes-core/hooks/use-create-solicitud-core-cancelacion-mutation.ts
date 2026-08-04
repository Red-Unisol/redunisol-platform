import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createSolicitudCoreCancelacion } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import type { CreateSolicitudCoreCancelacionRequest } from "@/modules/solicitudes/types/solicitudes-core";

export function useCreateSolicitudCoreCancelacionMutation(solicitudId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateSolicitudCoreCancelacionRequest) =>
      createSolicitudCoreCancelacion(solicitudId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.cancelaciones(solicitudId),
      });
    },
  });
}
