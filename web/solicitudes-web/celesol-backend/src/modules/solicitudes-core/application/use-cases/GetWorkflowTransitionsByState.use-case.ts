import type { GetWorkflowTransitionsByStateInput } from "../dtos/GetWorkflowTransitionsByState.dto";
import type { WorkflowTransitionAdminRepository } from "../../domain/repositories/WorkflowTransitionAdminRepository";
import { WorkflowTransitionStateNotFoundError } from "../../domain/solicitudes-core-errors";

type Dependencies = {
  repository: WorkflowTransitionAdminRepository;
};

export class GetWorkflowTransitionsByStateUseCase {
  private readonly repository: WorkflowTransitionAdminRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(input: GetWorkflowTransitionsByStateInput) {
    const state = await this.repository.findStateGroupByCode(input.stateCode);

    if (!state) {
      throw new WorkflowTransitionStateNotFoundError();
    }

    return state;
  }
}
