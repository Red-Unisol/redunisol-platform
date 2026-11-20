import { useMutation, useQueryClient } from "@tanstack/react-query";

import { documentReviewKey } from "@/modules/solicitudes-core/services/document-review-api";
import { executeSolicitudCoreTransition } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";
import type { ExecuteWorkflowTransitionRequest } from "@/modules/solicitudes/types/solicitudes-core";
import { ApiError } from "@/shared/services/http/api-error";

type UseExecuteSolicitudCoreTransitionMutationOptions = {
  isHistoryEnabled?: boolean;
};

function shouldRefreshWorkflowData(error: unknown) {
  return (
    error instanceof ApiError && (error.status === 403 || error.status === 409)
  );
}

export function useExecuteSolicitudCoreTransitionMutation(
  solicitudId: string,
  options: UseExecuteSolicitudCoreTransitionMutationOptions = {},
) {
  const queryClient = useQueryClient();
  const { isHistoryEnabled = false } = options;

  return useMutation({
    mutationFn: (payload: ExecuteWorkflowTransitionRequest) =>
      executeSolicitudCoreTransition(solicitudId, payload),
    onError: async (error) => {
      await queryClient.invalidateQueries({queryKey: solicitudesCoreQueryKeys.adjuntos(solicitudId)});
      if (!shouldRefreshWorkflowData(error)) {
        return;
      }

      const invalidations = [
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.detail(solicitudId),
        }),
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.transitions(solicitudId),
        }),
      ];

      if (isHistoryEnabled) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: solicitudesCoreQueryKeys.history(solicitudId),
          }),
        );
      }

      await Promise.all(invalidations);
    },
    onSuccess: async (response, command) => {
      queryClient.setQueryData(
        solicitudesCoreQueryKeys.detail(solicitudId),
        response.solicitud,
      );
      queryClient.setQueryData(
        solicitudesCoreQueryKeys.transitions(solicitudId),
        response.transitions,
      );

      const invalidations = [
        queryClient.invalidateQueries({queryKey: solicitudesCoreQueryKeys.adjuntos(solicitudId)}),
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.precargaAll,
        }),
        queryClient.invalidateQueries({
          queryKey: solicitudesCoreQueryKeys.recientesAll,
        }),
      ];

      if (["enviar_a_liquidada", "finalizar_revision_datos"].includes(command.actionCode)) {
        // La ficha resuelve permisos y correcciones para el área que está mirando.
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: solicitudesCoreQueryKeys.detail(solicitudId) }),
          queryClient.invalidateQueries({ queryKey: documentReviewKey(solicitudId) }),
        );
      }

      if (isHistoryEnabled) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: solicitudesCoreQueryKeys.history(solicitudId),
          }),
        );
      }

      await Promise.all(invalidations);
    },
  });
}
