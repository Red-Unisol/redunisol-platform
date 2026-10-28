import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  generarComprobanteRefinanciacion,
  type RefinanciacionPrestamoRequest,
} from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

// Boton "Generar PDF": guarda las cuotas y deja el comprobante en los
// adjuntos de la solicitud.
export function useGenerarComprobanteRefinanciacionMutation(solicitudId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (prestamos: RefinanciacionPrestamoRequest[]) =>
      generarComprobanteRefinanciacion(solicitudId, prestamos),
    onSuccess: async (resultado) => {
      queryClient.setQueryData(
        solicitudesCoreQueryKeys.refinanciacion(solicitudId),
        { prestamos: resultado.prestamos, updatedAt: resultado.updatedAt },
      );
      await queryClient.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.adjuntos(solicitudId),
      });
    },
  });
}
