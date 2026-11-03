import assert from "node:assert/strict";
import { it } from "node:test";
import { REVERSE_DISMISSAL_ACTION } from "./Dismissal";
import { SolicitudWorkflowPlanBuilder } from "./SolicitudWorkflowPlanBuilder";
import { SolicitudTransitionPolicy } from "./SolicitudTransitionPolicy";
import type { WorkflowValidationContext } from "./types";
import { changeSolicitudStateBodySchema } from "../../presentation/SolicitudWorkflowRequest.schema";

function context(code: string): WorkflowValidationContext {
  return {
    command: { actionCode: REVERSE_DISMISSAL_ACTION, solicitudId: "s", changedBy: "admin",
      now: new Date(), workflowOwnerId: "owner", isSystemAdmin: true, comment: "Desestimada por error",
      dismissalReversal: { historyId: "client-forged", expectedUpdatedAt: "client-forged" } },
    transitionValidation: {
      solicitud: { estadoActualId: "dismissed", stateCode: "Desestimada", ownerId: "owner" },
      transition: { isActive: true, requiresComment: true, toStateIsActive: true, toStateId: "previous",
        toStateCode: code, toStateOwnerCode: "RIESGO",
        dismissalReversal: { historyId: "server-history", expectedUpdatedAt: "2026-11-03T12:00:00.000Z" } },
    },
  };
}

it("reversal uses only server evidence and never chains Motor or auto-assignment", () => {
  for (const state of ["Motor", "RevisionRiesgo", "Confirmada"]) {
    const c = context(state);
    const plan = new SolicitudWorkflowPlanBuilder().build(c.command, c);
    assert.equal(plan.steps.length, 1);
    const step = plan.steps[0]!;
    assert.equal(step.kind, "domain-transition");
    assert(step.kind === "domain-transition");
    assert.equal(step.toStateId, "previous");
    assert.equal(plan.command.dismissalReversal?.historyId, "server-history");
  }
});

it("even the current Historial owner cannot reverse without administrator rights or a reason", () => {
  const c = context("Revisar");
  const policy = new SolicitudTransitionPolicy();
  assert.throws(() => policy.validate({ ...c, command: { ...c.command, isSystemAdmin: false } }));
  assert.throws(() => policy.validate({ ...c, command: { ...c.command, comment: " " } }));
  assert.doesNotThrow(() => policy.validate(c));
});

it("HTTP requests cannot supply a restoration destination or forge dismissal evidence", () => {
  const body = { actionCode: REVERSE_DISMISSAL_ACTION, comment: "Restaurar por error" };
  assert.equal(changeSolicitudStateBodySchema.safeParse(body).success, true);
  for (const extra of [{ toStateId: "arbitrary" }, { targetStateCode: "Pagada" },
    { dismissalReversal: { historyId: "forged" } }]) {
    assert.equal(changeSolicitudStateBodySchema.safeParse({ ...body, ...extra }).success, false);
  }
});
