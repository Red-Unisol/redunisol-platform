import type {
  ExecuteSolicitudWorkflowResult,
  SolicitudTransitionValidationContext,
} from "../repositories/SolicitudWorkflowRepository";
export type {
  WorkflowExecutionPlan,
  WorkflowExecutionStep,
  WorkflowTechnicalExecutionStep,
  WorkflowAutoAssignmentExecutionStep,
} from "./contracts";
import type {
  ExecuteSolicitudTransitionInput,
} from "./contracts";

export type WorkflowCommand = ExecuteSolicitudTransitionInput;

export type WorkflowValidationContext = {
  command: WorkflowCommand;
  transitionValidation: SolicitudTransitionValidationContext;
};

export type WorkflowExecutionResult = ExecuteSolicitudWorkflowResult;
