import type { AuthUser } from "@/modules/auth/services/auth-api";

// Los mismos que ESTADOS_CON_TOPE_DE_RIESGO del backend: Riesgo le devuelve la
// solicitud al vendedor, que puede bajar el monto pero no pasar del aprobado.
const ESTADOS_CON_TOPE_DE_RIESGO = ["PreAprobada", "Revisar"];

/** Tope del monto para este usuario, o null si no tiene (Riesgo y administradores no tienen). */
export function getTopeMontoRiesgo(
  user: Pick<AuthUser, "isSystemAdmin" | "workflowOwner"> | null | undefined,
  solicitud: {
    estadoActual: { code: string };
    montoAprobadoRiesgo?: number | null;
  },
) {
  if (!user || user.isSystemAdmin || user.workflowOwner?.code === "RIESGO") {
    return null;
  }

  if (!ESTADOS_CON_TOPE_DE_RIESGO.includes(solicitud.estadoActual.code)) {
    return null;
  }

  return solicitud.montoAprobadoRiesgo ?? null;
}

/** Mismo mensaje que devuelve el backend al rechazar el monto. */
export function getMontoSuperaTopeError(monto: number, tope: number | null) {
  if (tope === null || !(monto > tope)) {
    return null;
  }

  return `El monto máximo es el devuelto por Riesgo: ${formatTope(tope)}.`;
}

function formatTope(value: number) {
  return `$${value.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}
