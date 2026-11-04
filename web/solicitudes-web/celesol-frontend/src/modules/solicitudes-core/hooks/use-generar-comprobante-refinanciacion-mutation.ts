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
    mutationFn: (input: {
      fechaCalculo: string | null;
      prestamos: RefinanciacionPrestamoRequest[];
    }) =>
      generarComprobanteRefinanciacion(
        solicitudId,
        input.prestamos,
        input.fechaCalculo,
      ),
    onSuccess: async (resultado) => {
      queryClient.setQueryData(
        solicitudesCoreQueryKeys.refinanciacion(solicitudId),
        {
          fechaCalculo: resultado.fechaCalculo ?? null,
          prestamos: resultado.prestamos,
          updatedAt: resultado.updatedAt,
        },
      );
      await queryClient.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.adjuntos(solicitudId),
      });
    },
  });
}
