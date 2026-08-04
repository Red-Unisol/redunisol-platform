import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patchSolicitudCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import type { PatchSolicitudCoreRequest } from "@/modules/solicitudes/types/solicitudes-core";

export function usePatchSolicitudCoreMutation(solicitudId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: PatchSolicitudCoreRequest) =>
      patchSolicitudCore(solicitudId, payload),
    onSuccess: async (updatedSolicitud) => {
      queryClient.setQueryData(
        solicitudesCoreQueryKeys.detail(solicitudId),
        updatedSolicitud,
      );

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.detail(solicitudId),
        }),
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.precargaAll,
        }),
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.recientesAll,
        }),
      ]);
    },
  });
}
