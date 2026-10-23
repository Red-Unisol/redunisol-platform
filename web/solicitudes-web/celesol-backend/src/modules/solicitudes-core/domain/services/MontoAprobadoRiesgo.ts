import { ESTADOS_CON_TOPE_DE_RIESGO } from "../entities/SolicitudCore.entity";
import { MontoSuperaAprobadoRiesgoError } from "../solicitudes-core-errors";

export function assertMontoDentroDelAprobadoPorRiesgo(
  solicitud: { estadoActual: { code: string }; montoAprobadoRiesgo?: number | null },
  montoAFinanciar: number | null,
) {
  const tope = solicitud.montoAprobadoRiesgo ?? null;
  if (!ESTADOS_CON_TOPE_DE_RIESGO.includes(solicitud.estadoActual.code) || tope === null)
    return;

  const montoFormateado = `$${tope.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
  if (montoAFinanciar === null) {
    throw new MontoSuperaAprobadoRiesgoError(
      `Ingresá un monto de hasta ${montoFormateado}, el aprobado por Riesgo.`,
    );
  }
  if (montoAFinanciar > tope) {
    throw new MontoSuperaAprobadoRiesgoError(
      `El monto máximo es el devuelto por Riesgo: ${montoFormateado}.`,
    );
  }
}
