import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createSolicitudCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import type { CreateSolicitudCoreRequest } from "@/modules/solicitudes/types/solicitudes-core";

import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useCreateSolicitudCoreMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSolicitudCoreRequest) =>
      createSolicitudCore(payload),
    onSuccess: async () => {
      await Promise.all(
        [
          solicitudesCoreQueryKeys.precargaAll,
          solicitudesCoreQueryKeys.recientesAll,
          solicitudesCoreQueryKeys.historicasAll,
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });
}
