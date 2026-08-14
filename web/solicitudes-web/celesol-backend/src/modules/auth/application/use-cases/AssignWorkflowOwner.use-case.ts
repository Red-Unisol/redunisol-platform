import { WorkflowOwnerNotFoundOrInactiveError } from "../../domain/auth-errors";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { AssignWorkflowOwnerInput } from "../dtos/AssignWorkflowOwner.dto";

type AssignWorkflowOwnerUseCaseDependencies = {
  userRepository: AuthRepository;
};

export class AssignWorkflowOwnerUseCase {
  private readonly userRepository: AuthRepository;

  constructor(dependencies: AssignWorkflowOwnerUseCaseDependencies) {
    this.userRepository = dependencies.userRepository;
  }

  async execute(input: AssignWorkflowOwnerInput) {
    if (input.workflowOwnerId !== null) {
      const owner = await this.userRepository.findActiveWorkflowOwnerById(
        input.workflowOwnerId,
      );

      if (!owner) {
        throw new WorkflowOwnerNotFoundOrInactiveError();
      }
    }

    return this.userRepository.assignWorkflowOwner({
      userId: input.userId,
      workflowOwnerId: input.workflowOwnerId,
    });
  }
}
