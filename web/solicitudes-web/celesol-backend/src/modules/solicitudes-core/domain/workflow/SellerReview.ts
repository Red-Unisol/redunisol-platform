const DIRECT_ANALYSIS_ACTIONS = new Set(["liquidar", "liquidar_con_firma"]);

// Internal routing actions have a catalog entry for an auditable transition.
// Only the public completion action may resolve them, after locking the request.
export function sellerReviewAllowsAction(state: string, startedAt: Date | null | undefined, action: string) {
  if (action === "devolver_revision_datos") return false;
  if (state === "Liquidada" && startedAt) return action === "finalizar_revision_datos" || action === "desestimar";
  if (state === "Confirmada" && startedAt && DIRECT_ANALYSIS_ACTIONS.has(action)) return false;
  return action !== "finalizar_revision_datos";
}
