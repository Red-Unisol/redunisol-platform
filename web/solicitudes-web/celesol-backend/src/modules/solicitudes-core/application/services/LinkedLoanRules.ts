import { AdministrativeCorrectionError, assertNoLoanReplacementPending } from "../../domain/workflow/AdministrativeCorrection";
import type { CoreLoanSnapshot } from "../../infrastructure/services/AdministrativeCorrectionService";
import type { CoreLoanLifecycle } from "../../infrastructure/services/ControlledLoanReplacementService";

export type LinkedLoanSource = {
  id?: string;
  legacyOid: string | null;
  montoAFinanciar: unknown;
  administrativeCoreControl?: unknown;
  titular?: { nroDocumento?: string | null } | null;
};

export type LinkedLoanGateways = {
  lifecycle: (id: string, directLoanId?: boolean) => Promise<CoreLoanLifecycle | null>;
  loanSnapshot: (id: string, documento: string, directLoanId?: boolean) => Promise<CoreLoanSnapshot | null>;
};

export type LinkedLoanStatus = {
  status: "none" | "active" | "cancelled";
  currentLoanId: string | null;
  resolvedLoanId: string | null;
  amount: number | null;
  requestedAmount: number | null;
  matchesAmount: boolean;
  amountEditable: boolean;
};
export type LinkedLoanReader = (source: LinkedLoanSource) => Promise<LinkedLoanStatus>;

export const fullyCancelledLoan = (loan: CoreLoanLifecycle | null) => {
  const cancelled = (v: string | null) => /^anulad[oa]$/i.test(v?.trim() ?? "");
  return Boolean(loan?.id && cancelled(loan.estadoLabel) && cancelled(loan.estadoPrestamoLabel) &&
    loan.vigente === false && loan.saldo === 0);
};

const amount = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const cents = (n: number) => Math.round(n * 100);
const formatted = (n: number | null) => n === null ? "sin verificar" :
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });

/** Reads the authoritative loan. Missing/contradictory data is never cancellation. */
export async function inspectLinkedLoan(source: LinkedLoanSource, gateways: LinkedLoanGateways): Promise<LinkedLoanStatus> {
  assertNoLoanReplacementPending(source);
  const requestedAmount = amount(source.montoAFinanciar);
  const base = { currentLoanId: source.legacyOid, requestedAmount, resolvedLoanId: null, amount: null, matchesAmount: false };
  if (!source.legacyOid) return { ...base, status: "none", amountEditable: true };
  const direct = Boolean((source.administrativeCoreControl as Record<string, unknown> | null)?.replacementId ||
    (source.administrativeCoreControl as Record<string, unknown> | null)?.generatedLoanId);
  try {
    const lifecycle = await gateways.lifecycle(source.legacyOid, direct);
    if (fullyCancelledLoan(lifecycle))
      return { ...base, status: "cancelled", resolvedLoanId: lifecycle!.id, amountEditable: true };
    if (!lifecycle?.id || lifecycle.estado !== 0 ||
      /anulad[oa]/i.test(`${lifecycle.estadoLabel ?? ""} ${lifecycle.estadoPrestamoLabel ?? ""}`) ||
      !source.titular?.nroDocumento) throw new Error("Unknown loan lifecycle");
    const snapshot = await gateways.loanSnapshot(source.legacyOid, source.titular.nroDocumento, direct);
    const loanAmount = amount(snapshot?.amount);
    if (!snapshot || snapshot.id !== lifecycle.id || snapshot.estado !== 0 || loanAmount === null)
      throw new Error("Unknown loan amount or borrower");
    return { ...base, status: "active", resolvedLoanId: snapshot.id, amount: loanAmount,
      matchesAmount: requestedAmount !== null && cents(loanAmount) === cents(requestedAmount), amountEditable: false };
  } catch {
    throw new AdministrativeCorrectionError(`No se pudo verificar el estado y el monto del préstamo ${source.legacyOid} en Vimarx. Actualizá antes de continuar.`);
  }
}

export function assertLinkedLoanReady(loan: LinkedLoanStatus) {
  if (loan.status === "none") throw new AdministrativeCorrectionError("Generá el préstamo antes de finalizar el análisis.");
  if (loan.status === "cancelled") throw new AdministrativeCorrectionError(`El préstamo ${loan.currentLoanId} está anulado. Regenerá el préstamo y reemplazá el anterior antes de continuar.`);
  if (!loan.matchesAmount) throw new AdministrativeCorrectionError(
    `Préstamo con monto distinto (${formatted(loan.amount)} vs ${formatted(loan.requestedAmount)}). Por favor anulá el préstamo preexistente ${loan.currentLoanId} en Vimarx.`,
  );
}

export function assertLinkedLoanAmountEditable(loan: LinkedLoanStatus) {
  if (!loan.amountEditable) throw new AdministrativeCorrectionError(
    `El monto está congelado por el préstamo ${loan.currentLoanId}. Para editarlo, primero anulá ese préstamo en Vimarx.`,
  );
}
