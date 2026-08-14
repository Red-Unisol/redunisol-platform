import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getWorkflowPlanExecutabilityIssues,
  type WorkflowExecutionPlan,
} from "./contracts";

describe("workflow execution plan executability preconditions", () => {
  it("returns no issues for a minimally executable plan", () => {
    const plan = workflowPlan({
      expectedFromStateId: "state-carga",
      stepFromStateId: "state-carga",
      withDomainStep: true,
    });

    const issues = getWorkflowPlanExecutabilityIssues(plan);

    assert.deepEqual(issues, []);
  });

  it("flags missing expected state", () => {
    const plan = workflowPlan({
      expectedFromStateId: null,
      stepFromStateId: "state-carga",
      withDomainStep: true,
    });

    const issues = getWorkflowPlanExecutabilityIssues(plan);

    assert.deepEqual(issues, ["expected_state_missing"]);
  });

  it("flags missing domain step", () => {
    const plan = workflowPlan({
      expectedFromStateId: "state-carga",
      stepFromStateId: "state-carga",
      withDomainStep: false,
    });

    const issues = getWorkflowPlanExecutabilityIssues(plan);

    assert.deepEqual(issues, ["missing_domain_step"]);
  });

  it("flags mismatch between expected fromState and first domain step fromState", () => {
    const plan = workflowPlan({
      expectedFromStateId: "state-carga",
      stepFromStateId: "state-riesgo",
      withDomainStep: true,
    });

    const issues = getWorkflowPlanExecutabilityIssues(plan);

    assert.deepEqual(issues, ["domain_from_state_mismatch"]);
  });

  it("flags missing domain transition input for malformed plan payloads", () => {
    const malformedPlan = {
      ...workflowPlan({
        expectedFromStateId: "state-carga",
        stepFromStateId: "state-carga",
        withDomainStep: true,
      }),
      steps: [
        {
          actionCode: "enviar",
          fromStateId: "state-carga",
          kind: "domain-transition",
          technical: false,
          toStateId: "state-motor",
          transitionId: "tr-enviar",
        },
      ],
    } as unknown as WorkflowExecutionPlan;

    const issues = getWorkflowPlanExecutabilityIssues(malformedPlan);

    assert.deepEqual(issues, ["missing_domain_transition_input"]);
  });
});

function workflowPlan(input: {
  expectedFromStateId: string | null;
  stepFromStateId: string | null;
  withDomainStep: boolean;
}): WorkflowExecutionPlan {
  const command = {
    actionCode: "enviar",
    changedBy: "user-1",
    now: new Date("2026-05-18T12:00:00.000Z"),
    solicitudId: "sol-1",
    workflowOwnerId: "owner-vendedor",
  };

  return {
    command,
    expectedState: {
      fromStateId: input.expectedFromStateId,
    },
    steps: input.withDomainStep
      ? [
          {
            actionCode: "enviar",
            fromStateId: input.stepFromStateId,
            kind: "domain-transition",
            technical: false,
            toStateId: "state-motor",
            transitionId: "tr-enviar",
            transitionInput: command,
          },
        ]
      : [],
  };
}
