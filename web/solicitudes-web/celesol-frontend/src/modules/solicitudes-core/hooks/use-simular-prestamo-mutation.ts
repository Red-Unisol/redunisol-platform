import { useMutation } from "@tanstack/react-query";

import { simularPrestamo } from "@/modules/solicitudes-core/services/solicitudes-core-api";

export function useSimularPrestamoMutation() {
  return useMutation({
    mutationFn: simularPrestamo,
  });
}
