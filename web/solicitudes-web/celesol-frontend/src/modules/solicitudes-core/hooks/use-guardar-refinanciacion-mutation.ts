import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  guardarSolicitudRefinanciacion,
  type RefinanciacionPrestamoRequest,
} from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export function useGuardarRefinanciacionMutation(solicitudId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (prestamos: RefinanciacionPrestamoRequest[]) =>
      guardarSolicitudRefinanciacion(solicitudId, prestamos),
    onSuccess: (guardada) => {
      queryClient.setQueryData(
        solicitudesCoreQueryKeys.refinanciacion(solicitudId),
        { prestamos: guardada.prestamos, updatedAt: guardada.updatedAt },
      );
    },
  });
}
