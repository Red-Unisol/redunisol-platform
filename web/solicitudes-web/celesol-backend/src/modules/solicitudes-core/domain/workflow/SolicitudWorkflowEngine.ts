import type { SolicitudWorkflowRepository } from "../repositories/SolicitudWorkflowRepository";
import { SolicitudTransitionPolicy } from "./SolicitudTransitionPolicy";
import { SolicitudWorkflowPlanBuilder } from "./SolicitudWorkflowPlanBuilder";
import { SolicitudWorkflowPlanExecutor } from "./SolicitudWorkflowPlanExecutor";
import type {
  WorkflowCommand,
  WorkflowExecutionResult,
  WorkflowValidationContext,
} from "./types";

type WorkflowResultDecorator = {
  decorate(result: WorkflowExecutionResult): WorkflowExecutionResult;
};

type Dependencies = {
  capabilitiesService?: WorkflowResultDecorator;
  getValidationContext?: (
    command: WorkflowCommand,
  ) => Promise<WorkflowValidationContext>;
  planBuilder?: SolicitudWorkflowPlanBuilder;
  planExecutor?: SolicitudWorkflowPlanExecutor;
  repository?: SolicitudWorkflowRepository;
  transitionPolicy?: SolicitudTransitionPolicy;
};

export class SolicitudWorkflowEngine {
  private readonly capabilitiesService: WorkflowResultDecorator;
  private readonly getValidationContext: (
    command: WorkflowCommand,
  ) => Promise<WorkflowValidationContext>;
  private readonly planBuilder: SolicitudWorkflowPlanBuilder;
  private readonly planExecutor: SolicitudWorkflowPlanExecutor;
  private readonly transitionPolicy: SolicitudTransitionPolicy;

  constructor(dependencies: Dependencies) {
    const repository = dependencies.repository;
    const planExecutor =
      dependencies.planExecutor ??
      (repository
        ? new SolicitudWorkflowPlanExecutor({ repository })
        : null);

    if (!planExecutor) {
      throw new Error(
        "SolicitudWorkflowEngine requires either planExecutor or repository.",
      );
    }

    const getValidationContext =
      dependencies.getValidationContext ??
      (repository?.getTransitionValidationContext
        ? async (command: WorkflowCommand) => ({
            command,
            transitionValidation:
              await repository.getTransitionValidationContext!({
                actionCode: command.actionCode,
                solicitudId: command.solicitudId,
              }),
          })
        : async (command: WorkflowCommand) => ({
            command,
            transitionValidation: {
              solicitud: null,
              transition: null,
            },
          }));

    this.capabilitiesService = dependencies.capabilitiesService ?? {
      decorate: (result) => result,
    };
    this.getValidationContext = getValidationContext;
    this.planBuilder =
      dependencies.planBuilder ?? new SolicitudWorkflowPlanBuilder();
    this.planExecutor = planExecutor;
    this.transitionPolicy =
      dependencies.transitionPolicy ?? new SolicitudTransitionPolicy();
  }

  async execute(command: WorkflowCommand) {
    const validationContext = await this.getValidationContext(command);

    this.transitionPolicy.validate(validationContext);
    const plan = this.planBuilder.build(command, validationContext);
    const result = await this.planExecutor.execute(plan);

    return this.capabilitiesService.decorate(result);
  }
}
