import type { SolicitudCore } from "../entities/SolicitudCore.entity";
import type { WorkflowTransition } from "../entities/WorkflowTransition.entity";

export type ExecuteSolicitudTransitionInput = {
  actionCode: string;
  changedBy: string;
  comment?: string;
  isSystemAdmin?: boolean;
  motivo?: string;
  now: Date;
  solicitudId: string;
  workflowOwnerId: string;
  workflowOwnerCode?: string | null;
};

export type WorkflowExecutionStep = {
  kind: "domain-transition";
  transitionInput: ExecuteSolicitudTransitionInput;
  actionCode: string;
  fromStateId: string | null;
  toStateId: string | null;
  transitionId: string | null;
  technical: false;
};

export type WorkflowTechnicalExecutionStep = {
  actionCode: string;
  fromStateId: string;
  toStateId: string | null;
  transitionId: string | null;
  kind: "technical-transition";
  technical: true;
};

// Paso de reparto automatico. No mueve el estado de la solicitud: solo asigna
// un ejecutivo cuando la solicitud entra a un owner que reparte por turno.
// Igual que el paso "motor", es declarativo: el "a quien" se resuelve y
// revalida contra la base dentro de la transaccion, no aca.
export type WorkflowAutoAssignmentExecutionStep = {
  kind: "auto-assignment";
  actionCode: string;
  technical: true;
};

export type WorkflowExecutionPlan = {
  command: ExecuteSolicitudTransitionInput;
  // In 2C.1.x, null is allowed only for non-executable plans built without
  // solicitud snapshot context. Productive execution by steps in 2C.2 must
  // require a non-null expected state.
  expectedState: {
    fromStateId: string | null;
  };
  steps: Array<
    | WorkflowExecutionStep
    | WorkflowTechnicalExecutionStep
    | WorkflowAutoAssignmentExecutionStep
  >;
};

export type ExecuteSolicitudWorkflowPlanInput = {
  plan: WorkflowExecutionPlan;
};

export type ExecuteSolicitudWorkflowResult = {
  solicitud: SolicitudCore;
  transitions: WorkflowTransition[];
};

export type WorkflowPlanExecutabilityIssue =
  | "expected_state_missing"
  | "missing_domain_step"
  | "missing_domain_transition_input"
  | "domain_from_state_mismatch";

export function getWorkflowPlanExecutabilityIssues(
  plan: WorkflowExecutionPlan,
): WorkflowPlanExecutabilityIssue[] {
  const issues: WorkflowPlanExecutabilityIssue[] = [];
  const expectedFromStateId = plan.expectedState.fromStateId;
  const firstDomainStep = plan.steps.find(
    (step) => step.kind === "domain-transition",
  );

  if (expectedFromStateId === null) {
    issues.push("expected_state_missing");
  }

  if (!firstDomainStep) {
    issues.push("missing_domain_step");
    return issues;
  }

  if (!firstDomainStep.transitionInput) {
    issues.push("missing_domain_transition_input");
  }

  if (
    expectedFromStateId !== null &&
    firstDomainStep.fromStateId !== expectedFromStateId
  ) {
    issues.push("domain_from_state_mismatch");
  }

  return issues;
}

