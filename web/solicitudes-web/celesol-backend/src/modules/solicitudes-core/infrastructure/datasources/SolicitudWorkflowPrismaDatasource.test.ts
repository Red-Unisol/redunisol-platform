import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import {
  ForbiddenSolicitudAccessError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudCoreNotFoundError,
  SolicitudWorkflowTransitionNotAllowedError,
  WorkflowExecutionPlanStateConflictError,
} from "../../domain/solicitudes-core-errors";
import { SolicitudWorkflowPrismaDatasource } from "./SolicitudWorkflowPrismaDatasource";

describe("SolicitudWorkflowPrismaDatasource", () => {
  it("lists active transitions from the solicitud current state ordered by catalog sort", async () => {
    const prisma = new FakeWorkflowPrisma();
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());

    const transitions = await datasource.listAvailableTransitions({
      solicitudId: "sol-1",
      workflowOwnerId: "owner-vendedor",
    });

    assert.equal(prisma.solicitudFindUniqueCalls[0]?.where.id, "sol-1");
    assert.equal(prisma.transitionFindManyCalls[0]?.where.fromStateId, "state-carga");
    assert.equal(prisma.transitionFindManyCalls[0]?.where.isActive, true);
    assert.deepEqual(transitions.map((transition) => transition.actionCode), [
      "enviar",
      "desestimar",
    ]);
    assert.equal(transitions[0]?.defaultComment, "Pase a riesgo");
    assert.equal(transitions[0]?.toState.owner.code, "SISTEMA");
  });

  it("rejects list when the user has no workflow owner assignment", async () => {
    const datasource = new SolicitudWorkflowPrismaDatasource(
      new FakeWorkflowPrisma().client(),
    );

    await assert.rejects(
      () =>
        datasource.listAvailableTransitions({
          solicitudId: "sol-1",
          workflowOwnerId: "",
        }),
      MissingWorkflowOwnerAssignmentError,
    );
  });

  it("rejects list when the solicitud belongs to another workflow owner", async () => {
    const datasource = new SolicitudWorkflowPrismaDatasource(
      new FakeWorkflowPrisma().client(),
    );

    await assert.rejects(
      () =>
        datasource.listAvailableTransitions({
          solicitudId: "sol-1",
          workflowOwnerId: "owner-riesgo",
        }),
      ForbiddenSolicitudAccessError,
    );
  });

  it("executes workflow plan in one transaction and writes audit snapshots", async () => {
    const prisma = new FakeWorkflowPrisma();
    const now = new Date("2026-05-18T12:00:00.000Z");
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());

    const result = await datasource.executeWorkflowPlan({
      plan: {
        command: {
          actionCode: "enviar",
          changedBy: "user-1",
          comment: "  Comentario manual  ",
          motivo: "Revision inicial",
          now,
          solicitudId: "sol-1",
          workflowOwnerId: "owner-vendedor",
        },
        expectedState: {
          fromStateId: "state-carga",
        },
        steps: [
          {
            actionCode: "enviar",
            fromStateId: "state-carga",
            kind: "domain-transition",
            technical: false,
            toStateId: "state-motor",
            transitionId: "tr-enviar",
            transitionInput: {
              actionCode: "enviar",
              changedBy: "user-1",
              comment: "  Comentario manual  ",
              motivo: "Revision inicial",
              now,
              solicitudId: "sol-1",
              workflowOwnerId: "owner-vendedor",
            },
          },
          {
            actionCode: "motor",
            fromStateId: "state-motor",
            kind: "technical-transition",
            technical: true,
            toStateId: "state-riesgo",
            transitionId: "tr-motor",
          },
        ],
      },
    });

    assert.equal(prisma.transactionCount, 1);
    assert.equal(prisma.solicitudUpdateCalls[0]?.where.id, "sol-1");
    assert.deepEqual(prisma.solicitudUpdateCalls[0]?.data, {
      estadoActual: {
        connect: {
          id: "state-motor",
        },
      },
    });
    assert.deepEqual(prisma.solicitudUpdateCalls[1]?.data, {
      estadoActual: {
        connect: {
          id: "state-riesgo",
        },
      },
    });
    assert.deepEqual(prisma.historyCreateCalls[0]?.data, {
      actionCode: "enviar",
      actionLabel: "Enviar",
      changedAt: now,
      changedBy: "user-1",
      comentario: "Pase a riesgo\n\nComentario manual",
      estadoAnteriorId: "state-carga",
      estadoNuevoId: "state-motor",
      fromOwnerCodeSnapshot: "VENDEDORES",
      fromOwnerIdSnapshot: "owner-vendedor",
      fromOwnerNameSnapshot: "Vendedores",
      fromStateCodeSnapshot: "CargaVendedor",
      fromStateNameSnapshot: "Carga vendedor",
      motivo: "Revision inicial",
      requiresComment: false,
      saveAndExit: false,
      solicitudId: "sol-1",
      toOwnerCodeSnapshot: "SISTEMA",
      toOwnerIdSnapshot: "owner-sistema",
      toOwnerNameSnapshot: "Sistema",
      toStateCodeSnapshot: "Motor",
      toStateNameSnapshot: "Motor",
      transitionId: "tr-enviar",
    });
    assert.deepEqual(prisma.historyCreateCalls[1]?.data, {
      actionCode: "motor",
      actionLabel: "Motor",
      changedAt: now,
      changedBy: "user-1",
      comentario: null,
      estadoAnteriorId: "state-motor",
      estadoNuevoId: "state-riesgo",
      fromOwnerCodeSnapshot: "SISTEMA",
      fromOwnerIdSnapshot: "owner-sistema",
      fromOwnerNameSnapshot: "Sistema",
      fromStateCodeSnapshot: "Motor",
      fromStateNameSnapshot: "Motor",
      motivo: null,
      requiresComment: false,
      saveAndExit: false,
      solicitudId: "sol-1",
      toOwnerCodeSnapshot: "RIESGO",
      toOwnerIdSnapshot: "owner-riesgo",
      toOwnerNameSnapshot: "Riesgo",
      toStateCodeSnapshot: "RevisionRiesgo",
      toStateNameSnapshot: "Revision riesgo",
      transitionId: "tr-motor",
    });
    assert.equal(result.solicitud.estadoActual.id, "state-riesgo");
    assert.equal(result.solicitud.assignedToUserId, null);
    assert.deepEqual(result.transitions.map((transition) => transition.actionCode), [
      "preaprobar",
    ]);
  });

  it("executes workflow plan using the first domain-transition without changing runtime path", async () => {
    const prisma = new FakeWorkflowPrisma();
    const now = new Date("2026-05-18T12:00:00.000Z");
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());

    const result = await datasource.executeWorkflowPlan({
      plan: {
        command: {
          actionCode: "enviar",
          changedBy: "user-1",
          now,
          solicitudId: "sol-1",
          workflowOwnerId: "owner-vendedor",
        },
        expectedState: {
          fromStateId: "state-carga",
        },
        steps: [
          {
            actionCode: "enviar",
            fromStateId: "state-carga",
            kind: "domain-transition",
            technical: false,
            toStateId: "state-motor",
            transitionId: "tr-enviar",
            transitionInput: {
              actionCode: "enviar",
              changedBy: "user-1",
              now,
              solicitudId: "sol-1",
              workflowOwnerId: "owner-vendedor",
            },
          },
          {
            actionCode: "motor",
            fromStateId: "state-motor",
            kind: "technical-transition",
            technical: true,
            toStateId: "state-riesgo",
            transitionId: "tr-motor",
          },
        ],
      },
    });

    assert.equal(prisma.transactionCount, 1);
    assert.equal(prisma.solicitudUpdateCalls.length, 2);
    assert.equal(result.solicitud.estadoActual.id, "state-riesgo");
    assert.equal(
      (prisma.historyCreateCalls[0] as { data: { actionCode: string } }).data
        .actionCode,
      "enviar",
    );
    assert.equal(
      (prisma.historyCreateCalls[1] as { data: { actionCode: string } }).data
        .actionCode,
      "motor",
    );
  });

  it("stores only defaultComment when manual comment is empty", async () => {
    const prisma = new FakeWorkflowPrisma();
    const now = new Date("2026-05-18T12:00:00.000Z");
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());

    await datasource.executeWorkflowPlan({
      plan: {
        command: {
          actionCode: "enviar",
          changedBy: "user-1",
          comment: "   ",
          now,
          solicitudId: "sol-1",
          workflowOwnerId: "owner-vendedor",
        },
        expectedState: {
          fromStateId: "state-carga",
        },
        steps: [
          {
            actionCode: "enviar",
            fromStateId: "state-carga",
            kind: "domain-transition",
            technical: false,
            toStateId: "state-motor",
            transitionId: "tr-enviar",
            transitionInput: {
              actionCode: "enviar",
              changedBy: "user-1",
              comment: "   ",
              now,
              solicitudId: "sol-1",
              workflowOwnerId: "owner-vendedor",
            },
          },
        ],
      },
    });

    assert.equal(
      (prisma.historyCreateCalls[0] as { data: { comentario: string | null } })
        .data.comentario,
      "Pase a riesgo",
    );
  });

  it("stores only manual comment when defaultComment is null", async () => {
    const prisma = new FakeWorkflowPrisma({
      activeTransition: transitionRecord({
        defaultComment: null,
      }),
    });
    const now = new Date("2026-05-18T12:00:00.000Z");
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());

    await datasource.executeWorkflowPlan({
      plan: {
        command: {
          actionCode: "enviar",
          changedBy: "user-1",
          comment: "Comentario manual",
          now,
          solicitudId: "sol-1",
          workflowOwnerId: "owner-vendedor",
        },
        expectedState: {
          fromStateId: "state-carga",
        },
        steps: [
          {
            actionCode: "enviar",
            fromStateId: "state-carga",
            kind: "domain-transition",
            technical: false,
            toStateId: "state-motor",
            transitionId: "tr-enviar",
            transitionInput: {
              actionCode: "enviar",
              changedBy: "user-1",
              comment: "Comentario manual",
              now,
              solicitudId: "sol-1",
              workflowOwnerId: "owner-vendedor",
            },
          },
        ],
      },
    });

    assert.equal(
      (prisma.historyCreateCalls[0] as { data: { comentario: string | null } })
        .data.comentario,
      "Comentario manual",
    );
  });

  it("stores null when neither defaultComment nor manual comment is present", async () => {
    const prisma = new FakeWorkflowPrisma({
      activeTransition: transitionRecord({
        defaultComment: null,
      }),
    });
    const now = new Date("2026-05-18T12:00:00.000Z");
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());

    await datasource.executeWorkflowPlan({
      plan: {
        command: {
          actionCode: "enviar",
          changedBy: "user-1",
          now,
          solicitudId: "sol-1",
          workflowOwnerId: "owner-vendedor",
        },
        expectedState: {
          fromStateId: "state-carga",
        },
        steps: [
          {
            actionCode: "enviar",
            fromStateId: "state-carga",
            kind: "domain-transition",
            technical: false,
            toStateId: "state-motor",
            transitionId: "tr-enviar",
            transitionInput: {
              actionCode: "enviar",
              changedBy: "user-1",
              now,
              solicitudId: "sol-1",
              workflowOwnerId: "owner-vendedor",
            },
          },
        ],
      },
    });

    assert.equal(
      (prisma.historyCreateCalls[0] as { data: { comentario: string | null } })
        .data.comentario,
      null,
    );
  });

  it("rejects workflow plan when domain step transitionId does not match DB transition", async () => {
    const prisma = new FakeWorkflowPrisma();
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());
    const now = new Date("2026-05-18T12:00:00.000Z");

    await assert.rejects(
      () =>
        datasource.executeWorkflowPlan({
          plan: {
            command: {
              actionCode: "enviar",
              changedBy: "user-1",
              now,
              solicitudId: "sol-1",
              workflowOwnerId: "owner-vendedor",
            },
            expectedState: {
              fromStateId: "state-carga",
            },
            steps: [
              {
                actionCode: "enviar",
                fromStateId: "state-carga",
                kind: "domain-transition",
                technical: false,
                toStateId: "state-motor",
                transitionId: "tr-mismatch",
                transitionInput: {
                  actionCode: "enviar",
                  changedBy: "user-1",
                  now,
                  solicitudId: "sol-1",
                  workflowOwnerId: "owner-vendedor",
                },
              },
            ],
          },
        }),
      SolicitudWorkflowTransitionNotAllowedError,
    );
  });

  it("rejects workflow plan when domain step toStateId does not match DB transition", async () => {
    const prisma = new FakeWorkflowPrisma();
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());
    const now = new Date("2026-05-18T12:00:00.000Z");

    await assert.rejects(
      () =>
        datasource.executeWorkflowPlan({
          plan: {
            command: {
              actionCode: "enviar",
              changedBy: "user-1",
              now,
              solicitudId: "sol-1",
              workflowOwnerId: "owner-vendedor",
            },
            expectedState: {
              fromStateId: "state-carga",
            },
            steps: [
              {
                actionCode: "enviar",
                fromStateId: "state-carga",
                kind: "domain-transition",
                technical: false,
                toStateId: "state-desestimada",
                transitionId: "tr-enviar",
                transitionInput: {
                  actionCode: "enviar",
                  changedBy: "user-1",
                  now,
                  solicitudId: "sol-1",
                  workflowOwnerId: "owner-vendedor",
                },
              },
            ],
          },
        }),
      SolicitudWorkflowTransitionNotAllowedError,
    );
  });

  it("rolls back workflow plan execution when technical Motor step fails", async () => {
    const prisma = new FakeWorkflowPrisma({
      enableMotorTransition: false,
    });
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());
    const now = new Date("2026-05-18T12:00:00.000Z");

    await assert.rejects(
      () =>
        datasource.executeWorkflowPlan({
          plan: {
            command: {
              actionCode: "enviar",
              changedBy: "user-1",
              now,
              solicitudId: "sol-1",
              workflowOwnerId: "owner-vendedor",
            },
            expectedState: {
              fromStateId: "state-carga",
            },
            steps: [
              {
                actionCode: "enviar",
                fromStateId: "state-carga",
                kind: "domain-transition",
                technical: false,
                toStateId: "state-motor",
                transitionId: "tr-enviar",
                transitionInput: {
                  actionCode: "enviar",
                  changedBy: "user-1",
                  now,
                  solicitudId: "sol-1",
                  workflowOwnerId: "owner-vendedor",
                },
              },
              {
                actionCode: "motor",
                fromStateId: "state-motor",
                kind: "technical-transition",
                technical: true,
                toStateId: null,
                transitionId: null,
              },
            ],
          },
        }),
      SolicitudWorkflowTransitionNotAllowedError,
    );

    assert.equal(prisma.currentSolicitudStateId(), "state-carga");
    assert.equal(prisma.historyCreateCalls.length, 0);
  });

  it("fails with conflict when initial expected state does not match current solicitud state", async () => {
    const prisma = new FakeWorkflowPrisma();
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());
    const now = new Date("2026-05-18T12:00:00.000Z");

    await assert.rejects(
      () =>
        datasource.executeWorkflowPlan({
          plan: {
            command: {
              actionCode: "enviar",
              changedBy: "user-1",
              now,
              solicitudId: "sol-1",
              workflowOwnerId: "owner-vendedor",
            },
            expectedState: {
              fromStateId: "state-riesgo",
            },
            steps: [
              {
                actionCode: "enviar",
                fromStateId: "state-carga",
                kind: "domain-transition",
                technical: false,
                toStateId: "state-motor",
                transitionId: "tr-enviar",
                transitionInput: {
                  actionCode: "enviar",
                  changedBy: "user-1",
                  now,
                  solicitudId: "sol-1",
                  workflowOwnerId: "owner-vendedor",
                },
              },
            ],
          },
        }),
      WorkflowExecutionPlanStateConflictError,
    );

    assert.equal(prisma.solicitudUpdateCalls.length, 0);
    assert.equal(prisma.historyCreateCalls.length, 0);
    assert.equal(prisma.currentSolicitudStateId(), "state-carga");
  });

  it("fails with conflict and rolls back when a step fromStateId does not match current state", async () => {
    const prisma = new FakeWorkflowPrisma();
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());
    const now = new Date("2026-05-18T12:00:00.000Z");

    await assert.rejects(
      () =>
        datasource.executeWorkflowPlan({
          plan: {
            command: {
              actionCode: "enviar",
              changedBy: "user-1",
              now,
              solicitudId: "sol-1",
              workflowOwnerId: "owner-vendedor",
            },
            expectedState: {
              fromStateId: "state-carga",
            },
            steps: [
              {
                actionCode: "enviar",
                fromStateId: "state-carga",
                kind: "domain-transition",
                technical: false,
                toStateId: "state-motor",
                transitionId: "tr-enviar",
                transitionInput: {
                  actionCode: "enviar",
                  changedBy: "user-1",
                  now,
                  solicitudId: "sol-1",
                  workflowOwnerId: "owner-vendedor",
                },
              },
              {
                actionCode: "motor",
                fromStateId: "state-riesgo",
                kind: "technical-transition",
                technical: true,
                toStateId: null,
                transitionId: null,
              },
            ],
          },
        }),
      WorkflowExecutionPlanStateConflictError,
    );

    assert.equal(prisma.currentSolicitudStateId(), "state-carga");
    assert.equal(prisma.historyCreateCalls.length, 0);
  });

  it("does not log assignment cleanup on Enviar auto-chain when starting assigned", async () => {
    const prisma = new FakeWorkflowPrisma({
      currentSolicitud: solicitudRecord({
        assignedToUserId: "assignee-1",
      }),
    });
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());

    await executeDomainStepPlan(datasource, {
      actionCode: "enviar",
      changedBy: "user-1",
      now: new Date("2026-05-18T12:00:00.000Z"),
      solicitudId: "sol-1",
      workflowOwnerId: "owner-vendedor",
    });

    const assignmentClearEvents = prisma.historyCreateCalls.filter(
      (call) =>
        (call as { data: { actionCode: string } }).data.actionCode ===
        "ASSIGNMENT_CLEARED_ON_OWNER_CHANGE",
    );
    assert.equal(assignmentClearEvents.length, 0);
  });

  it("keeps assignedToUserId when transition stays in the same owner", async () => {
    const datasource = new SolicitudWorkflowPrismaDatasource(
      new FakeWorkflowPrisma({
        activeTransition: transitionRecord({
          actionCode: "confirmar",
          actionLabel: "Confirmar",
          fromStateId: "state-riesgo",
          id: "tr-riesgo-confirmar",
          toState: stateRecord({
            code: "Confirmada",
            id: "state-confirmada",
            isInitial: false,
            name: "Confirmada",
            owner: ownerRecord({
              code: "RIESGO",
              id: "owner-riesgo",
              name: "Riesgo",
            }),
          }),
          toStateid: "state-confirmada",
        }),
        currentSolicitud: solicitudRecord({
          assignedToUserId: "assignee-1",
          estadoActual: stateRecord({
            code: "RevisionRiesgo",
            id: "state-riesgo",
            isInitial: false,
            name: "Revision riesgo",
            owner: ownerRecord({
              code: "RIESGO",
              id: "owner-riesgo",
              name: "Riesgo",
            }),
          }),
          estadoActualId: "state-riesgo",
        }),
      }).client(),
    );

    const result = await executeDomainStepPlan(datasource, {
      actionCode: "confirmar",
      changedBy: "user-riesgo",
      now: new Date("2026-05-18T12:00:00.000Z"),
      solicitudId: "sol-1",
      workflowOwnerId: "owner-riesgo",
    });

    assert.equal(result.solicitud.assignedToUserId, "assignee-1");
  });

  it("keeps assignedToUserId when transition changes owner", async () => {
    const prisma = new FakeWorkflowPrisma({
      activeTransition: transitionRecord({
        actionCode: "preaprobar",
        actionLabel: "PreAprobada",
        fromStateId: "state-riesgo",
        id: "tr-riesgo-preaprobado",
        toState: stateRecord({
          code: "PreAprobada",
          id: "state-preaprobada",
          isInitial: false,
          name: "Pre Aprobada",
          owner: ownerRecord({
            code: "VENDEDORES",
            id: "owner-vendedor",
            name: "Vendedores",
          }),
        }),
        toStateId: "state-preaprobada",
      }),
      currentSolicitud: solicitudRecord({
        assignedToUserId: "assignee-1",
        estadoActual: stateRecord({
          code: "RevisionRiesgo",
          id: "state-riesgo",
          isInitial: false,
          name: "Revision riesgo",
          owner: ownerRecord({
            code: "RIESGO",
            id: "owner-riesgo",
            name: "Riesgo",
          }),
        }),
        estadoActualId: "state-riesgo",
      }),
    });
    const datasource = new SolicitudWorkflowPrismaDatasource(
      prisma.client(),
    );

    const result = await executeDomainStepPlan(datasource, {
      actionCode: "preaprobar",
      changedBy: "user-riesgo",
      now: new Date("2026-05-18T12:00:00.000Z"),
      solicitudId: "sol-1",
      workflowOwnerId: "owner-riesgo",
    });

    assert.equal(result.solicitud.assignedToUserId, "assignee-1");
    assert.equal(prisma.historyCreateCalls.length, 1);
  });

  it("does not log assignment-clear event when owner changes and solicitud is unassigned", async () => {
    const prisma = new FakeWorkflowPrisma({
      activeTransition: transitionRecord({
        actionCode: "preaprobar",
        fromStateId: "state-riesgo",
        toState: stateRecord({
          code: "PreAprobada",
          id: "state-preaprobada",
          isInitial: false,
          name: "Pre Aprobada",
          owner: ownerRecord({
            code: "VENDEDORES",
            id: "owner-vendedor",
            name: "Vendedores",
          }),
        }),
        toStateId: "state-preaprobada",
      }),
      currentSolicitud: solicitudRecord({
        assignedToUserId: null,
        estadoActual: stateRecord({
          code: "RevisionRiesgo",
          id: "state-riesgo",
          isInitial: false,
          name: "Revision riesgo",
          owner: ownerRecord({
            code: "RIESGO",
            id: "owner-riesgo",
            name: "Riesgo",
          }),
        }),
        estadoActualId: "state-riesgo",
      }),
    });
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());

    await executeDomainStepPlan(datasource, {
      actionCode: "preaprobar",
      changedBy: "user-riesgo",
      now: new Date("2026-05-18T12:00:00.000Z"),
      solicitudId: "sol-1",
      workflowOwnerId: "owner-riesgo",
    });

    assert.equal(prisma.historyCreateCalls.length, 1);
    assert.equal(
      (prisma.historyCreateCalls[0] as { data: { actionCode: string } }).data
        .actionCode,
      "preaprobar",
    );
  });

  it("rejects inactive or missing transition from the current state", async () => {
    const datasource = new SolicitudWorkflowPrismaDatasource(
      new FakeWorkflowPrisma({ activeTransition: null }).client(),
    );

    await assert.rejects(
      () =>
        executeDomainStepPlan(datasource, {
          actionCode: "no_catalogada",
          changedBy: "user-1",
          now: new Date("2026-05-18T12:00:00.000Z"),
          solicitudId: "sol-1",
          workflowOwnerId: "owner-vendedor",
        }),
      SolicitudWorkflowTransitionNotAllowedError,
    );
  });

  it("rejects action that exists in catalog but not from current state", async () => {
    const datasource = new SolicitudWorkflowPrismaDatasource(
      new FakeWorkflowPrisma({
        activeTransition: null,
      }).client(),
    );

    await assert.rejects(
      () =>
        executeDomainStepPlan(datasource, {
          actionCode: "preaprobar",
          changedBy: "user-1",
          expectedFromStateId: "state-carga",
          now: new Date("2026-05-18T12:00:00.000Z"),
          solicitudId: "sol-1",
          workflowOwnerId: "owner-vendedor",
        }),
      SolicitudWorkflowTransitionNotAllowedError,
    );
  });

  it("returns history ordered by changedAt descending with owner snapshots", async () => {
    const prisma = new FakeWorkflowPrisma();
    const datasource = new SolicitudWorkflowPrismaDatasource(prisma.client());

    const history = await datasource.listHistory({
      currentUser: {
        id: "operator-1",
        workflowOwnerId: "owner-vendedor",
      },
      solicitudId: "sol-1",
    });

    assert.equal(prisma.historyFindManyCalls[0]?.orderBy.changedAt, "desc");
    assert.ok(prisma.historyFindManyCalls[0]?.include);
    assert.deepEqual(history, [
      {
        actionCode: "enviar",
        actionLabel: "Enviar",
        changedAt: new Date("2026-05-18T12:00:00.000Z"),
        changedBy: "user-1",
        changedByFullName: "Ada Lovelace",
        comentario: "Comentario",
        estadoAnterior: {
          code: "CargaVendedor",
          name: "Carga vendedor",
          ownerCode: "VENDEDORES",
          ownerName: "Vendedores",
        },
        estadoNuevo: {
          code: "RevisionRiesgo",
          name: "Revision riesgo",
          ownerCode: "RIESGO",
          ownerName: "Riesgo",
        },
        id: "hist-1",
        motivo: "Revision inicial",
        solicitudId: "sol-1",
      },
    ]);
  });


  it("returns changedByFullName as null when changedBy user is missing", async () => {
    const datasource = new SolicitudWorkflowPrismaDatasource(
      new FakeWorkflowPrisma({
        historyRecords: [
          {
            ...defaultHistoryRecord(),
            changedBy: "user-404",
            changedByUser: null,
          },
        ],
      }).client(),
    );

    const history = await datasource.listHistory({
      currentUser: {
        id: "operator-1",
        workflowOwnerId: "owner-vendedor",
      },
      solicitudId: "sol-1",
    });

    assert.equal(history[0]?.changedByFullName, null);
  });

  it("returns changedByFullName as null when user name data is empty", async () => {
    const datasource = new SolicitudWorkflowPrismaDatasource(
      new FakeWorkflowPrisma({
        historyRecords: [
          {
            ...defaultHistoryRecord(),
            changedByUser: {
              firstName: "   ",
              lastName: "",
            },
          },
        ],
      }).client(),
    );

    const history = await datasource.listHistory({
      currentUser: {
        id: "operator-1",
        workflowOwnerId: "owner-vendedor",
      },
      solicitudId: "sol-1",
    });

    assert.equal(history[0]?.changedByFullName, null);
  });
  it("returns history for any authenticated user outside the current workflow owner", async () => {
    const datasource = new SolicitudWorkflowPrismaDatasource(
      new FakeWorkflowPrisma({
        currentSolicitud: solicitudRecord({
          createdBy: "creator-1",
          estadoActual: stateRecord({
            code: "RevisionRiesgo",
            id: "state-riesgo",
            isInitial: false,
            name: "Revision riesgo",
            owner: ownerRecord({
              code: "RIESGO",
              id: "owner-riesgo",
              name: "RIESGO",
            }),
          }),
          estadoActualId: "state-riesgo",
          participants: [],
        }),
      }).client(),
    );

    const history = await datasource.listHistory({
      currentUser: {
        id: "user-404",
        workflowOwnerId: "owner-vendedor",
      },
      solicitudId: "sol-1",
    });

    assert.equal(history.length, 1);
  });

  it("keeps participants read-only when listing history outside the current workflow owner", async () => {
    const datasource = new SolicitudWorkflowPrismaDatasource(
      new FakeWorkflowPrisma({
        currentSolicitud: solicitudRecord({
          createdBy: "creator-1",
          estadoActual: stateRecord({
            code: "RevisionRiesgo",
            id: "state-riesgo",
            isInitial: false,
            name: "Revision riesgo",
            owner: ownerRecord({
              code: "RIESGO",
              id: "owner-riesgo",
              name: "RIESGO",
            }),
          }),
          estadoActualId: "state-riesgo",
          participants: [{ userId: "participant-1" }],
        }),
      }).client(),
    );

    const history = await datasource.listHistory({
      currentUser: {
        id: "participant-1",
        workflowOwnerId: "owner-vendedor",
      },
      solicitudId: "sol-1",
    });

    assert.equal(history.length, 1);
  });

  it("rejects missing solicitud with the shared not found error", async () => {
    const datasource = new SolicitudWorkflowPrismaDatasource(
      new FakeWorkflowPrisma({ currentSolicitud: null }).client(),
    );

    await assert.rejects(
      () =>
        datasource.listHistory({
          currentUser: {
            id: "user-1",
            workflowOwnerId: "owner-vendedor",
          },
          solicitudId: "sol-missing",
        }),
      SolicitudCoreNotFoundError,
    );
  });
});

async function executeDomainStepPlan(
  datasource: SolicitudWorkflowPrismaDatasource,
  command: {
    actionCode: string;
    changedBy: string;
    comment?: string;
    expectedFromStateId?: string;
    expectedToStateId?: string | null;
    motivo?: string;
    now: Date;
    solicitudId: string;
    workflowOwnerId: string;
  },
) {
  const expectedFromStateId = command.expectedFromStateId ?? (command.actionCode === "preaprobar" ||
    command.actionCode === "confirmar"
    ? "state-riesgo"
    : "state-carga");
  const expectedToStateId = command.expectedToStateId ?? (command.actionCode === "preaprobar"
    ? "state-preaprobada"
    : command.actionCode === "confirmar"
    ? "state-confirmada"
    : command.actionCode === "no_catalogada"
    ? null
    : command.actionCode === "enviar"
    ? "state-motor"
    : null);

  return datasource.executeWorkflowPlan({
    plan: {
      command,
      expectedState: {
        fromStateId: expectedFromStateId,
      },
      steps: [
        {
          actionCode: command.actionCode,
          fromStateId: expectedFromStateId,
          kind: "domain-transition",
          technical: false,
          toStateId: expectedToStateId,
          transitionId: null,
          transitionInput: command,
        },
      ],
    },
  });
}

type HistoryRecord = Omit<ReturnType<typeof defaultHistoryRecord>, "changedByUser"> & {
  changedByUser?: {
    firstName: string | null;
    lastName: string | null;
  } | null;
};

type FakeWorkflowPrismaOptions = {
  activeTransition?: ReturnType<typeof transitionRecord> | null;
  currentSolicitud?: ReturnType<typeof solicitudRecord> | null;
  enableMotorTransition?: boolean;
  historyRecords?: HistoryRecord[];
};

class FakeWorkflowPrisma {
  historyCreateCalls: Array<{ data: unknown }> = [];
  historyFindManyCalls: Array<{ include?: unknown; orderBy: { changedAt: string } }> = [];
  solicitudFindUniqueCalls: Array<{ where: { id: string } }> = [];
  solicitudUpdateCalls: Array<{ data: unknown; where: { id: string } }> = [];
  transactionCount = 0;
  transitionFindFirstCalls: Array<unknown> = [];
  transitionFindManyCalls: Array<{
    where: { fromStateId: string; isActive: boolean };
  }> = [];

  private readonly activeTransition: ReturnType<typeof transitionRecord> | null;
  private readonly enableMotorTransition: boolean;
  private currentSolicitud: ReturnType<typeof solicitudRecord> | null;
  private readonly historyRecords: HistoryRecord[];

  constructor(options: FakeWorkflowPrismaOptions = {}) {
    this.activeTransition =
      options.activeTransition === undefined
        ? transitionRecord()
        : options.activeTransition;
    this.currentSolicitud =
      options.currentSolicitud === undefined
        ? solicitudRecord()
        : options.currentSolicitud;
    this.enableMotorTransition =
      options.enableMotorTransition === undefined
        ? true
        : options.enableMotorTransition;
    this.historyRecords =
      options.historyRecords === undefined
        ? [defaultHistoryRecord()]
        : options.historyRecords;
  }

  client() {
    return {
      solicitud: {
        findUnique: async (args: { where: { id: string } }) => {
          this.solicitudFindUniqueCalls.push(args);

          return this.currentSolicitud;
        },
        update: async (args: { data: unknown; where: { id: string } }) => {
          this.solicitudUpdateCalls.push(args);

          const data = args.data as {
            assignedToUser?: { disconnect?: boolean };
            estadoActual: { connect: { id: string } };
          };
          const toStateId = data.estadoActual.connect.id;
          const toState = resolveStateById(toStateId);

          this.currentSolicitud = this.currentSolicitud
            ? {
                ...this.currentSolicitud,
                assignedToUserId:
                  data.assignedToUser?.disconnect
                    ? null
                    : data.assignedToUser === undefined
                    ? this.currentSolicitud.assignedToUserId
                    : this.currentSolicitud.assignedToUserId,
                estadoActual: toState,
                estadoActualId: toState.id,
              }
            : null;

          return solicitudRecord({
            assignedToUserId: this.currentSolicitud?.assignedToUserId ?? null,
            estadoActual: toState,
            estadoActualId: toState.id,
          });
        },
      },
      solicitudEstadoHistorial: {
        create: async (args: { data: unknown }) => {
          this.historyCreateCalls.push(args);

          return args.data;
        },
        findMany: async (args: { include?: unknown; orderBy: { changedAt: string } }) => {
          this.historyFindManyCalls.push(args);

          return this.historyRecords;
        },
      },
      workflowTransition: {
        findFirst: async (
          args: { where: { actionCode: string; fromStateId: string } },
        ) => {
          this.transitionFindFirstCalls.push(args);

          if (
            args.where.actionCode === "motor" &&
            args.where.fromStateId === "state-motor"
          ) {
            if (!this.enableMotorTransition) {
              return null;
            }
            return transitionRecord({
              actionCode: "motor",
              actionLabel: "Motor",
              defaultComment: null,
              fromStateId: "state-motor",
              id: "tr-motor",
              toState: stateRecord({
                code: "RevisionRiesgo",
                id: "state-riesgo",
                isInitial: false,
                name: "Revision riesgo",
                owner: ownerRecord({
                  code: "RIESGO",
                  id: "owner-riesgo",
                  name: "Riesgo",
                }),
              }),
              toStateId: "state-riesgo",
            });
          }

          return this.activeTransition;
        },
        findMany: async (args: { where: { fromStateId: string; isActive: boolean } }) => {
          this.transitionFindManyCalls.push(args);

          return args.where.fromStateId === "state-riesgo"
            ? [
                transitionRecord({
                  actionCode: "preaprobar",
                  id: "tr-preaprobar",
                  sortOrder: 10,
                  toState: stateRecord({
                    code: "PreAprobada",
                    id: "state-preaprobada",
                    name: "Pre Aprobada",
                  }),
                  toStateId: "state-preaprobada",
                }),
              ]
            : [
                transitionRecord({
                  actionCode: "enviar",
                  sortOrder: 10,
                }),
                transitionRecord({
                  actionCode: "desestimar",
                  id: "tr-desestimar",
                  requiresComment: true,
                  sortOrder: 20,
                  toState: stateRecord({
                    code: "Desestimada",
                    id: "state-desestimada",
                    name: "Desestimada",
                    owner: ownerRecord({
                      code: "HISTORIAL",
                      id: "owner-historial",
                      name: "Historial",
                    }),
                  }),
                  toStateId: "state-desestimada",
                }),
              ];
        },
      },
      $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
        const snapshotSolicitud = this.currentSolicitud
          ? {
              ...this.currentSolicitud,
              estadoActual: { ...this.currentSolicitud.estadoActual },
            }
          : null;
        const snapshotHistoryCreateCalls = [...this.historyCreateCalls];
        this.transactionCount += 1;
        try {
          return await callback(this.client());
        } catch (error) {
          this.currentSolicitud = snapshotSolicitud;
          this.historyCreateCalls = snapshotHistoryCreateCalls;
          throw error;
        }
      },
    } as never;
  }

  currentSolicitudStateId() {
    return this.currentSolicitud?.estadoActualId ?? null;
  }
}

function defaultHistoryRecord() {
  return {
    actionCode: "enviar",
    actionLabel: "Enviar",
    changedAt: new Date("2026-05-18T12:00:00.000Z"),
    changedBy: "user-1",
    changedByUser: {
      firstName: "Ada",
      lastName: "Lovelace",
    },
    comentario: "Comentario",
    fromOwnerCodeSnapshot: "VENDEDORES",
    fromOwnerNameSnapshot: "Vendedores",
    fromStateCodeSnapshot: "CargaVendedor",
    fromStateNameSnapshot: "Carga vendedor",
    id: "hist-1",
    motivo: "Revision inicial",
    solicitudId: "sol-1",
    toOwnerCodeSnapshot: "RIESGO",
    toOwnerNameSnapshot: "Riesgo",
    toStateCodeSnapshot: "RevisionRiesgo",
    toStateNameSnapshot: "Revision riesgo",
  };
}
function ownerRecord(overrides: Record<string, unknown> = {}) {
  return {
    code: "VENDEDORES",
    id: "owner-vendedor",
    isActive: true,
    name: "Vendedores",
    sortOrder: 0,
    ...overrides,
  };
}

function stateRecord(overrides: Record<string, unknown> = {}) {
  const owner =
    "owner" in overrides ? (overrides.owner as ReturnType<typeof ownerRecord>) : ownerRecord();

  return {
    code: "CargaVendedor",
    createdAt: new Date("2026-05-18T10:00:00.000Z"),
    description: null,
    id: "state-carga",
    isActive: true,
    isInitial: true,
    isTerminal: false,
    name: "Carga vendedor",
    owner,
    ownerId: owner.id,
    updatedAt: new Date("2026-05-18T10:00:00.000Z"),
    ...overrides,
  };
}

function transitionRecord(
  overrides: Record<string, unknown> = {},
) {
  const toState =
    ("toState" in overrides
      ? (overrides.toState as ReturnType<typeof stateRecord>)
      : undefined) ??
    stateRecord({
      code: "Motor",
      id: "state-motor",
      isInitial: false,
      name: "Motor",
      owner: ownerRecord({
        code: "SISTEMA",
        id: "owner-sistema",
        name: "Sistema",
      }),
    });

  return {
    actionCode: "enviar",
    actionLabel: "Enviar",
    createdAt: new Date("2026-05-18T10:00:00.000Z"),
    defaultComment: "Pase a riesgo",
    description: null,
    fromStateId: "state-carga",
    id: "tr-enviar",
    isActive: true,
    requiresComment: false,
    saveAndExit: false,
    sortOrder: 10,
    toState,
    toStateId: toState.id,
    updatedAt: new Date("2026-05-18T10:00:00.000Z"),
    ...overrides,
  };
}

function solicitudRecord(
  overrides: Record<string, unknown> = {},
) {
  const estadoActual =
    "estadoActual" in overrides
      ? (overrides.estadoActual as ReturnType<typeof stateRecord>)
      : stateRecord();

  return {
    archivedAt: null,
    assignedToUser: null,
    assignedToUserId: null,
    conyuge: null,
    createdAt: new Date("2026-05-18T10:00:00.000Z"),
    createdBy: "user-1",
    cuotaResultante: null,
    cuotas: null,
    cupoTitular: null,
    datosLaborales: null,
    ejecutivoSolicitud: null,
    estadoActual,
    estadoActualId: estadoActual.id,
    fechaPrimerVencimiento: null,
    firmaDigitalmente: false,
    garantias: [],
    id: "sol-1",
    legacyOid: null,
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    montoAFinanciar: new Prisma.Decimal("1000.00"),
    motivo: null,
    nroOperacion: null,
    nroSolicitud: null,
    observaciones: null,
    participants: [],
    titular: null,
    updatedAt: new Date("2026-05-18T10:00:00.000Z"),
    vendedorSolicitud: null,
    ...overrides,
  };
}

function resolveStateById(stateId: string) {
  switch (stateId) {
    case "state-motor":
      return stateRecord({
        code: "Motor",
        id: "state-motor",
        isInitial: false,
        name: "Motor",
        owner: ownerRecord({
          code: "SISTEMA",
          id: "owner-sistema",
          name: "Sistema",
        }),
      });
    case "state-riesgo":
      return stateRecord({
        code: "RevisionRiesgo",
        id: "state-riesgo",
        isInitial: false,
        name: "Revision riesgo",
        owner: ownerRecord({
          code: "RIESGO",
          id: "owner-riesgo",
          name: "Riesgo",
        }),
      });
    case "state-confirmada":
      return stateRecord({
        code: "Confirmada",
        id: "state-confirmada",
        isInitial: false,
        name: "Confirmada",
        owner: ownerRecord({
          code: "RIESGO",
          id: "owner-riesgo",
          name: "Riesgo",
        }),
      });
    case "state-preaprobada":
      return stateRecord({
        code: "PreAprobada",
        id: "state-preaprobada",
        isInitial: false,
        name: "Pre Aprobada",
        owner: ownerRecord({
          code: "VENDEDORES",
          id: "owner-vendedor",
          name: "Vendedores",
        }),
      });
    case "state-desestimada":
      return stateRecord({
        code: "Desestimada",
        id: "state-desestimada",
        isInitial: false,
        isTerminal: true,
        name: "Desestimada",
        owner: ownerRecord({
          code: "HISTORIAL",
          id: "owner-historial",
          name: "Historial",
        }),
      });
    default:
      return stateRecord({
        id: stateId,
        isInitial: false,
      });
  }
}















