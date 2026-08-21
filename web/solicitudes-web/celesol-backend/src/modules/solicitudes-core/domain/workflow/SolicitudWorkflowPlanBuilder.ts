import type {
  WorkflowCommand,
  WorkflowExecutionPlan,
  WorkflowValidationContext,
} from "./types";

export class SolicitudWorkflowPlanBuilder {
  build(
    command: WorkflowCommand,
    context?: WorkflowValidationContext,
  ): WorkflowExecutionPlan {
    const fromStateId = context?.transitionValidation.solicitud?.estadoActualId ?? null;
    const transition = context?.transitionValidation.transition;
    const plan: WorkflowExecutionPlan = {
      command,
      expectedState: {
        fromStateId,
      },
      steps: [
        {
          actionCode: command.actionCode,
          fromStateId,
          kind: "domain-transition",
          technical: false,
          toStateId: transition?.toStateId ?? null,
          transitionId: transition?.transitionId ?? null,
          transitionInput: command,
        },
      ],
    };

    if (transition?.toStateCode === "Motor" && transition.toStateId) {
      plan.steps.push({
        actionCode: "motor",
        fromStateId: transition.toStateId,
        kind: "technical-transition",
        technical: true,
        toStateId: null,
        transitionId: null,
      });
    }

    return plan;
  }
}
