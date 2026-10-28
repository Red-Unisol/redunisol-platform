import { useQuery } from "@tanstack/react-query";

import {
  getSolicitudRefinanciacion,
  simularRefinanciacion,
} from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export type RefinanciacionTotal = {
  cantidadPrestamos: number;
  /** Mensaje de Vimarx si no acepta alguna de las cuotas guardadas. */
  error: string | null;
  /** Lo ya cobrado + lo que Vimarx calcula hoy para lo pendiente. */
  total: number;
};

// Para el resumen del desembolso: cuanto se descuenta del en mano por la
// refinanciacion guardada. Es lo mismo que calcula el backend al generar el
// prestamo, asi que se pide de nuevo cada vez que se abre el dialogo.
export function useRefinanciacionTotalQuery(id: string, enabled: boolean) {
  return useQuery({
    enabled: enabled && id.trim().length > 0,
    gcTime: 0,
    queryFn: async (): Promise<RefinanciacionTotal> => {
      const guardada = await getSolicitudRefinanciacion(id);
      const cobrado = guardada.prestamos
        .flatMap((prestamo) => prestamo.cobros ?? [])
        .reduce((total, cobro) => total + cobro.totalCobrado, 0);
      // Lo elegido que todavia no se cobro (un reintento despues de un fallo).
      const pendientes = guardada.prestamos
        .map((prestamo) => {
          const cobradas = new Set(
            (prestamo.cobros ?? []).flatMap((cobro) => cobro.nrosCuota),
          );

          return {
            nrosCuota: prestamo.nrosCuota.filter((nro) => !cobradas.has(nro)),
            prestamoId: prestamo.prestamoId,
          };
        })
        .filter((prestamo) => prestamo.nrosCuota.length > 0);

      if (pendientes.length === 0) {
        return {
          cantidadPrestamos: guardada.prestamos.length,
          error: null,
          total: cobrado,
        };
      }

      const simulacion = await simularRefinanciacion(id, pendientes);
      const rechazo = simulacion.prestamos.find((prestamo) => !prestamo.ok);

      return {
        cantidadPrestamos: guardada.prestamos.length,
        error: rechazo && !rechazo.ok ? rechazo.error : null,
        total: Math.round((cobrado + (simulacion.total ?? 0)) * 100) / 100,
      };
    },
    queryKey: solicitudesCoreQueryKeys.refinanciacionTotal(id),
    retry: false,
    staleTime: 0,
  });
}
