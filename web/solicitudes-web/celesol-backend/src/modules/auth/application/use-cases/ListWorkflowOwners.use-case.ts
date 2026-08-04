import type { AuthRepository } from "../../domain/repositories/AuthRepository";

type ListWorkflowOwnersUseCaseDependencies = {
  userRepository: AuthRepository;
};

export class ListWorkflowOwnersUseCase {
  private readonly userRepository: AuthRepository;

  constructor(dependencies: ListWorkflowOwnersUseCaseDependencies) {
    this.userRepository = dependencies.userRepository;
  }

  async execute() {
    return this.userRepository.listActiveWorkflowOwners();
  }
}
