import { useQuery } from "@tanstack/react-query";

import {
  getSolicitudRefinanciacion,
  listPrestamosDelSocio,
  simularRefinanciacion,
} from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "@/modules/solicitudes-core/services/solicitudes-core-query-keys";

export type RefinanciacionTotal = {
  /** Una linea por prestamo, para el resumen del desembolso. */
  detalle: {
    nroCuenta: string | null;
    nrosCuota: number[];
    prestamoId: string;
    total: number | null;
  }[];
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

      if (guardada.prestamos.length === 0) {
        return { detalle: [], error: null, total: 0 };
      }

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
      const [simulacion, prestamosDelSocio] = await Promise.all([
        pendientes.length > 0
          ? simularRefinanciacion(id, pendientes)
          : Promise.resolve(null),
        // Solo para mostrar el numero de cuenta: si falla, va sin el.
        listPrestamosDelSocio(id).catch(() => null),
      ]);
      const rechazo = simulacion?.prestamos.find((prestamo) => !prestamo.ok);
      const detalle = guardada.prestamos.map((prestamo) => {
        const cobrado = (prestamo.cobros ?? []).reduce(
          (total, cobro) => total + cobro.totalCobrado,
          0,
        );
        const simulado = simulacion?.prestamos.find(
          (item) => item.prestamoId === prestamo.prestamoId,
        );
        const total =
          simulado && !simulado.ok ? null : cobrado + (simulado?.totalPago ?? 0);

        return {
          nroCuenta:
            prestamosDelSocio?.prestamos.find(
              (item) => item.legacyId === prestamo.prestamoId,
            )?.nroCuenta ?? null,
          nrosCuota: prestamo.nrosCuota,
          prestamoId: prestamo.prestamoId,
          total: total === null ? null : Math.round(total * 100) / 100,
        };
      });

      return {
        detalle,
        error: rechazo && !rechazo.ok ? rechazo.error : null,
        total:
          Math.round(
            detalle.reduce((suma, item) => suma + (item.total ?? 0), 0) * 100,
          ) / 100,
      };
    },
    queryKey: solicitudesCoreQueryKeys.refinanciacionTotal(id),
    retry: false,
    staleTime: 0,
  });
}
