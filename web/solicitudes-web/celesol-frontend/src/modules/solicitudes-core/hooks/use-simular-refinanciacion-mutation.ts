import { useMutation } from "@tanstack/react-query";

import {
  simularRefinanciacion,
  type RefinanciacionPrestamoRequest,
} from "@/modules/solicitudes-core/services/solicitudes-core-api";

// Mutacion y no query: pega a Vimarx con la seleccion del momento, y se pide
// a mano ("Calcular") para no simular en cada tilde.
export function useSimularRefinanciacionMutation(solicitudId: string) {
  return useMutation({
    mutationFn: (input: {
      fechaCalculo: string | null;
      prestamos: RefinanciacionPrestamoRequest[];
    }) => simularRefinanciacion(solicitudId, input.prestamos, input.fechaCalculo),
  });
}
