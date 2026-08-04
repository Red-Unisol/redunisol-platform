import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createPrestamoLegacy } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useCreatePrestamoLegacyMutation(solicitudId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createPrestamoLegacy(solicitudId),
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
          queryKey: solicitudesCoreQueryKeys.transitions(solicitudId),
        }),
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.history(solicitudId),
        }),
      ]);
    },
  });
}
