import type { ListWorkflowTransitionsInput } from "../dtos/ListWorkflowTransitions.dto";
import type { WorkflowTransitionAdminRepository } from "../../domain/repositories/WorkflowTransitionAdminRepository";

type Dependencies = {
  repository: WorkflowTransitionAdminRepository;
};

export class ListWorkflowTransitionsUseCase {
  private readonly repository: WorkflowTransitionAdminRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(_input: ListWorkflowTransitionsInput) {
    const states = await this.repository.findAllStateGroups();

    return { states };
  }
}
