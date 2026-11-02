import { useQuery } from "@tanstack/react-query";

import { getMovimientosDeCuota } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

// Igual que el detalle del prestamo: pega a Vimarx en vivo, asi que se pide
// solo con la ventana de la cuota abierta (cuotaId distinto de null).
export function useMovimientosDeCuotaQuery(
  id: string,
  prestamoId: string,
  cuotaId: string | null,
) {
  return useQuery({
    enabled: id.trim().length > 0 && cuotaId !== null,
    queryFn: () => getMovimientosDeCuota(id, prestamoId, cuotaId ?? ""),
    queryKey: solicitudesCoreQueryKeys.movimientosDeCuota(
      id,
      prestamoId,
      cuotaId ?? "",
    ),
    retry: false,
  });
}
