import { createHash } from "node:crypto";
import { SolicitudesError } from "../../../solicitudes/domain/solicitudes-errors";

export const ADMIN_CORRECTION_ACTION = "ADMIN_CORRECTION_TO_REVISAR";
export const CORE_RECONCILIATION_REASON =
  "La corrección administrativa requiere conciliar el préstamo Core antes de liquidar. Un administrador debe verificar sus condiciones.";
export const CORE_GUARDED_ACTIONS = new Set(["liquidar", "verificar_firma", "transferir", "pagar"]);

export class AdministrativeCorrectionError extends SolicitudesError {
  constructor(message: string, status = 409) {
    super(message, status);
    this.name = "AdministrativeCorrectionError";
  }
}

export type ControlledSolicitud = {
  legacyOid: string | null;
  administrativeCoreControl?: unknown;
  montoAFinanciar: unknown;
  cuotas: number | null;
  lineaPrestamoLegacyOid: string;
  fechaPrimerVencimiento?: Date | string | null;
  titular?: { nroDocumento?: string | null; cuit?: string | null; nroSocio?: string | null } | null;
  cancelaciones?: { id: string; monto: unknown; deletedAt?: Date | null }[];
};

// The digest covers the inputs that can change the generated loan, including
// identity and cancellations. No personal data is copied into the control.
export function coreConditionsFingerprint(s: ControlledSolicitud) {
  return createHash("sha256").update(JSON.stringify({
    loan: s.legacyOid, monto: String(s.montoAFinanciar), cuotas: s.cuotas,
    linea: s.lineaPrestamoLegacyOid,
    vencimiento: s.fechaPrimerVencimiento ? new Date(s.fechaPrimerVencimiento).toISOString().slice(0, 10) : null,
    documento: s.titular?.nroDocumento, cuit: s.titular?.cuit, socio: s.titular?.nroSocio,
    cancelaciones: (s.cancelaciones ?? []).filter(c => !c.deletedAt)
      .map(c => [c.id, String(c.monto)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  })).digest("hex");
}

export function coreReconciliationPending(s: ControlledSolicitud) {
  if (!s.administrativeCoreControl) return false;
  const control = s.administrativeCoreControl as Record<string, unknown>;
  return control.loanId !== s.legacyOid ||
    control.reconciledFingerprint !== coreConditionsFingerprint(s);
}

export function assertCoreReconciled(s: ControlledSolicitud, action: string) {
  if (CORE_GUARDED_ACTIONS.has(action) && coreReconciliationPending(s))
    throw new AdministrativeCorrectionError(CORE_RECONCILIATION_REASON);
}
