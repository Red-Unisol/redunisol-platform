import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ForbiddenSolicitudAccessError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudWorkflowCommentRequiredError,
  SolicitudWorkflowDestinationInactiveError,
  SolicitudWorkflowTransitionNotAllowedError,
} from "../solicitudes-core-errors";
import { SolicitudTransitionPolicy } from "./SolicitudTransitionPolicy";
import type { WorkflowValidationContext } from "./types";

describe("SolicitudTransitionPolicy", () => {
  it("does not validate when solicitud is missing to preserve not-found precedence", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      transitionValidation: {
        solicitud: null,
        transition: null,
      },
    });

    assert.doesNotThrow(() => policy.validate(context));
  });

  it("rejects missing workflow owner assignment", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      command: {
        ...baseCommand(),
        workflowOwnerId: "",
      },
    });

    assert.throws(
      () => policy.validate(context),
      MissingWorkflowOwnerAssignmentError,
    );
  });

  it("rejects actor outside current owner", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      command: {
        ...baseCommand(),
        workflowOwnerId: "owner-x",
      },
    });

    assert.throws(() => policy.validate(context), ForbiddenSolicitudAccessError);
  });

  it("rejects missing transition candidate", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-1",
          ownerId: "owner-1",
        },
        transition: null,
      },
    });

    assert.throws(
      () => policy.validate(context),
      SolicitudWorkflowTransitionNotAllowedError,
    );
  });

  it("rejects inactive destination state", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-1",
          ownerId: "owner-1",
        },
        transition: {
          isActive: true,
          requiresComment: false,
          toStateIsActive: false,
        },
      },
    });

    assert.throws(
      () => policy.validate(context),
      SolicitudWorkflowDestinationInactiveError,
    );
  });

  it("requires a trimmed comment when transition requires it", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      command: {
        ...baseCommand(),
        comment: "   ",
      },
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-1",
          ownerId: "owner-1",
        },
        transition: {
          isActive: true,
          requiresComment: true,
          toStateIsActive: true,
        },
      },
    });

    assert.throws(
      () => policy.validate(context),
      SolicitudWorkflowCommentRequiredError,
    );
  });

  it("accepts valid context", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      command: {
        ...baseCommand(),
        comment: "ok",
      },
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-1",
          ownerId: "owner-1",
        },
        transition: {
          isActive: true,
          requiresComment: true,
          toStateIsActive: true,
        },
      },
    });

    assert.doesNotThrow(() => policy.validate(context));
  });

  it("allows a system admin to execute a valid transition without a matching workflow owner", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      command: {
        ...baseCommand(),
        comment: "ok",
        isSystemAdmin: true,
        workflowOwnerId: "",
      },
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-1",
          ownerId: "owner-1",
        },
        transition: {
          isActive: true,
          requiresComment: true,
          toStateIsActive: true,
        },
      },
    });

    assert.doesNotThrow(() => policy.validate(context));
  });

  it("still rejects a missing transition candidate for a system admin", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      command: {
        ...baseCommand(),
        isSystemAdmin: true,
        workflowOwnerId: "",
      },
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-1",
          ownerId: "owner-1",
        },
        transition: null,
      },
    });

    assert.throws(
      () => policy.validate(context),
      SolicitudWorkflowTransitionNotAllowedError,
    );
  });

  it("still requires a comment for a system admin when the transition demands it", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      command: {
        ...baseCommand(),
        comment: undefined,
        isSystemAdmin: true,
        workflowOwnerId: "",
      },
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-1",
          ownerId: "owner-1",
        },
        transition: {
          isActive: true,
          requiresComment: true,
          toStateIsActive: true,
        },
      },
    });

    assert.throws(
      () => policy.validate(context),
      SolicitudWorkflowCommentRequiredError,
    );
  });

  it("allows a RIESGO owner to execute the 'pagar' action despite not owning the solicitud", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      command: {
        ...baseCommand(),
        actionCode: "pagar",
        comment: undefined,
        workflowOwnerCode: "RIESGO",
        workflowOwnerId: "owner-tesoreria",
      },
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-transferir",
          ownerId: "owner-tesoreria",
        },
        transition: {
          isActive: true,
          requiresComment: false,
          toStateIsActive: true,
        },
      },
    });

    assert.doesNotThrow(() => policy.validate(context));
  });

  it("rejects a RIESGO owner for any action other than 'pagar'", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      command: {
        ...baseCommand(),
        actionCode: "transferir",
        workflowOwnerCode: "RIESGO",
        workflowOwnerId: "owner-riesgo",
      },
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-transferir",
          ownerId: "owner-tesoreria",
        },
        transition: {
          isActive: true,
          requiresComment: false,
          toStateIsActive: true,
        },
      },
    });

    assert.throws(() => policy.validate(context), ForbiddenSolicitudAccessError);
  });

  it("rejects a non-RIESGO, non-owner actor for the 'pagar' action", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      command: {
        ...baseCommand(),
        actionCode: "pagar",
        workflowOwnerCode: "VENDEDORES",
        workflowOwnerId: "owner-vendedores",
      },
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-transferir",
          ownerId: "owner-tesoreria",
        },
        transition: {
          isActive: true,
          requiresComment: false,
          toStateIsActive: true,
        },
      },
    });

    assert.throws(() => policy.validate(context), ForbiddenSolicitudAccessError);
  });

  it("rejects inactive transition candidate", () => {
    const policy = new SolicitudTransitionPolicy();
    const context = baseContext({
      transitionValidation: {
        solicitud: {
          estadoActualId: "state-1",
          ownerId: "owner-1",
        },
        transition: {
          isActive: false,
          requiresComment: false,
          toStateIsActive: true,
        },
      },
    });

    assert.throws(
      () => policy.validate(context),
      SolicitudWorkflowTransitionNotAllowedError,
    );
  });
});

function baseCommand() {
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

function baseContext(
  overrides: Partial<WorkflowValidationContext> = {},
): WorkflowValidationContext {
  const base: WorkflowValidationContext = {
    command: baseCommand(),
    transitionValidation: {
      solicitud: {
        estadoActualId: "state-1",
        ownerId: "owner-1",
      },
      transition: {
        isActive: true,
        requiresComment: false,
        toStateIsActive: true,
      },
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
