import { useMutation, useQueryClient } from "@tanstack/react-query";

import { assignSolicitudToUser } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useAssignSolicitudToUserMutation(solicitudId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (targetUserId: string) =>
      assignSolicitudToUser(solicitudId, targetUserId),
    onSuccess: async (updatedSolicitud) => {
      queryClient.setQueryData(
        solicitudesCoreQueryKeys.detail(solicitudId),
        updatedSolicitud,
      );

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.assignmentAgents(solicitudId),
        }),
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.detail(solicitudId),
        }),
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.history(solicitudId),
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
