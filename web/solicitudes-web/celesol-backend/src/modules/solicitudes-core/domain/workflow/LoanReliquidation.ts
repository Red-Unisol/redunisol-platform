import { AdministrativeCorrectionError } from "./AdministrativeCorrection";

export const RELIQUIDATION_ACTION = "RELIQUIDATION_REOPENED";
export type ReliquidationTransferState = "unpaid" | "paid" | "unknown";
export function assertReliquidationUnpaid(state: ReliquidationTransferState) {
  if (state !== "unpaid") throw new AdministrativeCorrectionError(state === "paid"
    ? "Reliquidación bloqueada: Vimarx registra la solicitud como Pagada."
    : "Reliquidación bloqueada: Vimarx no permite determinar el estado de transferencia de la solicitud. Requiere conciliación.");
}
export type Reliquidation = {
  requestId: string;
  previousLoanId: string;
  resolvedLoanId: string;
  reopenedAt: string;
  status: "AWAITING_LOAN" | "LINKED";
  newLoanId?: string;
};

export function reliquidation(value: unknown): Reliquidation | null {
  if (!value || typeof value !== "object") return null;
  const entry = (value as Record<string, unknown>).reliquidation;
  if (!entry || typeof entry !== "object") return null;
  const r = entry as Record<string, unknown>;
  return typeof r.requestId === "string" && typeof r.previousLoanId === "string" &&
    typeof r.resolvedLoanId === "string" && typeof r.reopenedAt === "string" &&
    ["AWAITING_LOAN", "LINKED"].includes(String(r.status)) ? r as Reliquidation : null;
}

export function assertReliquidationCancellation(loan: {
  id: string | null; estadoLabel: string | null; estadoPrestamoLabel: string | null;
  vigente: boolean | null; saldo: number | null;
} | null, expectedId?: string) {
  const cancelled = (v: string | null) => /^anulad[oa]$/i.test(v?.trim() ?? "");
  if (!loan?.id || (expectedId && loan.id !== expectedId) || !cancelled(loan.estadoLabel) ||
    !cancelled(loan.estadoPrestamoLabel) || loan.vigente !== false || loan.saldo !== 0)
    throw new AdministrativeCorrectionError("Vimarx debe confirmar la anulación del préstamo vinculado, sin vigencia y con saldo cero.");
}

/** Historical downstream stages belong to the former, explicitly closed cycle. */
export function currentLoanCycleSince(control: unknown): Date | undefined {
  const r = reliquidation(control);
  const date = r && new Date(r.reopenedAt);
  return date && Number.isFinite(date.getTime()) ? date : undefined;
}
