import { AdministrativeCorrectionError } from "./AdministrativeCorrection";

const DIRECT_ANALYSIS_ACTIONS = new Set(["liquidar", "liquidar_con_firma"]);

type AnalysisLoan = {
  estadoActual: { code: string };
  legacyOid: string | null;
  administrativeCoreControl?: unknown;
  sellerReviewStartedAt?: Date | null;
};

export function missingAnalysisControlReason(source: AnalysisLoan, action: string) {
  // Prisma reads both SQL NULL and a JSON null as null. An existing record
  // with pending reconciliation is handled by the regular financial guard.
  if (!source.legacyOid || source.administrativeCoreControl != null) return null;
  const confirmedHandoff = source.estadoActual.code === "Confirmada" &&
    (action === "enviar_a_liquidada" || DIRECT_ANALYSIS_ACTIONS.has(action));
  const sellerConfirmation = source.estadoActual.code === "Liquidada" &&
    source.sellerReviewStartedAt && action === "finalizar_revision_datos";
  return confirmedHandoff || sellerConfirmation
    ? "El préstamo vinculado no tiene registro de conciliación con Vimarx. No se puede avanzar con el análisis."
    : null;
}

export function assertAnalysisControl(source: AnalysisLoan, action: string) {
  const reason = missingAnalysisControlReason(source, action);
  if (reason) throw new AdministrativeCorrectionError(reason);
}

// Internal routing actions have a catalog entry for an auditable transition.
// Only the public completion action may resolve them, after locking the request.
export function sellerReviewAllowsAction(state: string, startedAt: Date | null | undefined, action: string) {
  if (action === "devolver_revision_datos") return false;
  if (state === "Liquidada" && startedAt) return action === "finalizar_revision_datos" || action === "desestimar";
  if (state === "Confirmada" && startedAt && DIRECT_ANALYSIS_ACTIONS.has(action)) return false;
  return action !== "finalizar_revision_datos";
}
