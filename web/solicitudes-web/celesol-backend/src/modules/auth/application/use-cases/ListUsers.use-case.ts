import type { AuthRepository } from "../../domain/repositories/AuthRepository";

type ListUsersUseCaseDependencies = {
  userRepository: AuthRepository;
};

export class ListUsersUseCase {
  private readonly userRepository: AuthRepository;

  constructor(dependencies: ListUsersUseCaseDependencies) {
    this.userRepository = dependencies.userRepository;
  }

  async execute() {
    return this.userRepository.listUsers();
  }
}
