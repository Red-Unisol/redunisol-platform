import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudWorkflowPlanBuilder } from "./SolicitudWorkflowPlanBuilder";
import type { WorkflowCommand, WorkflowValidationContext } from "./types";

describe("SolicitudWorkflowPlanBuilder", () => {
  it("builds a domain-transition step for a simple command", () => {
    const builder = new SolicitudWorkflowPlanBuilder();
    const command = workflowCommand();

    const plan = builder.build(command);

    assert.equal(plan.command, command);
    assert.equal(plan.expectedState.fromStateId, null);
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0]?.kind, "domain-transition");
    if (plan.steps[0]?.kind !== "domain-transition") {
      assert.fail("Expected a domain-transition step.");
    }
    assert.equal(plan.steps[0].transitionInput, command);
    assert.equal(plan.steps[0].actionCode, command.actionCode);
    assert.equal(plan.steps[0].fromStateId, null);
    assert.equal(plan.steps[0].toStateId, null);
    assert.equal(plan.steps[0].transitionId, null);
    assert.equal(plan.steps[0].technical, false);
  });

  it("preserves expectedState from validation context", () => {
    const builder = new SolicitudWorkflowPlanBuilder();
    const command = workflowCommand();
    const context = validationContext({
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-riesgo",
          ownerId: "owner-riesgo",
        },
        transition: null,
      },
    });

    const plan = builder.build(command, context);

    assert.equal(plan.expectedState.fromStateId, "state-riesgo");
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0]?.kind, "domain-transition");
  });

  it("keeps expectedState null when context has no solicitud snapshot", () => {
    const builder = new SolicitudWorkflowPlanBuilder();
    const command = workflowCommand();
    const context = validationContext({
      transitionValidation: {
        solicitud: null,
        transition: null,
      },
    });

    const plan = builder.build(command, context);

    assert.equal(plan.expectedState.fromStateId, null);
    assert.equal(plan.steps[0]?.kind, "domain-transition");
  });

  it("adds a technical Motor step when context has explicit Motor target", () => {
    const builder = new SolicitudWorkflowPlanBuilder();
    const command = workflowCommand();
    const context = validationContext({
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-carga",
          ownerId: "owner-vendedor",
        },
        transition: {
          isActive: true,
          requiresComment: false,
          transitionId: "tr-main",
          toStateCode: "Motor",
          toStateId: "state-motor",
          toStateIsActive: true,
        },
      },
    });

    const plan = builder.build(command, context);

    assert.equal(plan.steps.length, 2);
    assert.equal(plan.steps[0]?.kind, "domain-transition");
    assert.equal(plan.steps[1]?.kind, "technical-transition");
    if (plan.steps[1]?.kind !== "technical-transition") {
      assert.fail("Expected a technical-transition step.");
    }
    if (plan.steps[0]?.kind !== "domain-transition") {
      assert.fail("Expected a domain-transition step.");
    }
    assert.equal(plan.steps[0].transitionId, "tr-main");
    assert.equal(plan.steps[0].toStateId, "state-motor");
    assert.equal(plan.steps[1].actionCode, "motor");
    assert.equal(plan.steps[1].fromStateId, "state-motor");
    assert.equal(plan.steps[1].toStateId, null);
    assert.equal(plan.steps[1].transitionId, null);
    assert.equal(plan.steps[1].technical, true);
  });

  it("does not add technical step when Motor context is missing", () => {
    const builder = new SolicitudWorkflowPlanBuilder();
    const command = workflowCommand();
    const context = validationContext({
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-carga",
          ownerId: "owner-vendedor",
        },
        transition: {
          isActive: true,
          requiresComment: false,
          transitionId: "tr-main",
          toStateCode: "PreAprobada",
          toStateId: "state-preaprobada",
          toStateIsActive: true,
        },
      },
    });

    const plan = builder.build(command, context);

    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0]?.kind, "domain-transition");
  });
});

function workflowCommand(): WorkflowCommand {
  return {
    actionCode: "revisar",
    changedBy: "user-1",
    comment: "Falta documentacion",
    motivo: "Documentacion incompleta",
    now: new Date("2026-05-18T12:00:00.000Z"),
    solicitudId: "sol-1",
    workflowOwnerId: "owner-1",
  };
}

function validationContext(
  overrides: Partial<WorkflowValidationContext> = {},
): WorkflowValidationContext {
  const base: WorkflowValidationContext = {
    command: workflowCommand(),
    transitionValidation: {
      solicitud: {
        estadoActualId: "state-carga",
        ownerId: "owner-vendedor",
      },
      transition: null,
    },
  };

  return {
    ...base,
    ...overrides,
    command: {
      ...base.command,
      ...(overrides.command ?? {}),
    },
    transitionValidation: {
      ...base.transitionValidation,
      ...(overrides.transitionValidation ?? {}),
    },
  };
}
