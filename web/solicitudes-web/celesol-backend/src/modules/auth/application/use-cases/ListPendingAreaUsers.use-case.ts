import type { AuthRepository } from "../../domain/repositories/AuthRepository";

type ListPendingAreaUsersUseCaseDependencies = {
  userRepository: AuthRepository;
};

export class ListPendingAreaUsersUseCase {
  private readonly userRepository: AuthRepository;

  constructor(dependencies: ListPendingAreaUsersUseCaseDependencies) {
    this.userRepository = dependencies.userRepository;
  }

  async execute() {
    return this.userRepository.listPendingAreaUsers();
  }
}
