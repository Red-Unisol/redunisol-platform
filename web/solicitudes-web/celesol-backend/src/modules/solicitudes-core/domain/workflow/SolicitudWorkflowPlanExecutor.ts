import type { SolicitudWorkflowRepository } from "../repositories/SolicitudWorkflowRepository";
import { WorkflowExecutionPlanNotExecutableError } from "../solicitudes-core-errors";
import { getWorkflowPlanExecutabilityIssues } from "./contracts";
import type { WorkflowExecutionPlan } from "./types";

type Dependencies = {
  repository: SolicitudWorkflowRepository;
};

export class SolicitudWorkflowPlanExecutor {
  private readonly repository: SolicitudWorkflowRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  execute(plan: WorkflowExecutionPlan) {
    const issues = getWorkflowPlanExecutabilityIssues(plan);
    if (issues.length > 0) {
      throw new WorkflowExecutionPlanNotExecutableError(issues);
    }

    return this.repository.executeWorkflowPlan({ plan });
  }
}
