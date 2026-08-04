import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudWorkflowRepositoryImpl } from "./SolicitudWorkflowRepositoryImpl";

describe("SolicitudWorkflowRepositoryImpl", () => {
  it("delegates executeWorkflowPlan to datasource", async () => {
    let calledWithPlan = false;
    const datasource = {
      executeWorkflowPlan: async (input: { plan: { steps: unknown[] } }) => {
        calledWithPlan = input.plan.steps.length === 1;
        return {
          solicitud: {},
          transitions: [],
        };
      },
      getTransitionValidationContext: async () => ({
        solicitud: null,
        transition: null,
      }),
      listAvailableTransitions: async () => [],
      listHistory: async () => [],
    } as never;

    const repository = new SolicitudWorkflowRepositoryImpl(datasource);

    await repository.executeWorkflowPlan({
      plan: {
        command: {
          actionCode: "enviar",
          changedBy: "user-1",
          now: new Date("2026-05-18T12:00:00.000Z"),
          solicitudId: "sol-1",
          workflowOwnerId: "owner-1",
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
              now: new Date("2026-05-18T12:00:00.000Z"),
              solicitudId: "sol-1",
              workflowOwnerId: "owner-1",
            },
          },
        ],
      },
    });

    assert.equal(calledWithPlan, true);
  });
});
