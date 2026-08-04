import {
  InvalidCurrentPasswordError,
  UserNotFoundError,
} from "../../domain/auth-errors";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { PasswordHasher } from "../../domain/services/PasswordHasher";
import type { ChangeOwnPasswordInput } from "../dtos/ChangeOwnPassword.dto";

type ChangeOwnPasswordUseCaseDependencies = {
  passwordHasher: PasswordHasher;
  userRepository: AuthRepository;
};

export class ChangeOwnPasswordUseCase {
  private readonly passwordHasher: PasswordHasher;
  private readonly userRepository: AuthRepository;

  constructor(dependencies: ChangeOwnPasswordUseCaseDependencies) {
    this.passwordHasher = dependencies.passwordHasher;
    this.userRepository = dependencies.userRepository;
  }

  async execute(input: ChangeOwnPasswordInput): Promise<void> {
    const user = await this.userRepository.findByIdWithPasswordHash(
      input.userId,
    );

    if (!user) {
      throw new UserNotFoundError();
    }

    const passwordMatches = await this.passwordHasher.compare(
      input.currentPassword,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new InvalidCurrentPasswordError();
    }

    const passwordHash = await this.passwordHasher.hash(input.newPassword);

    await this.userRepository.updatePasswordAndRevokeSessions({
      passwordHash,
      userId: user.id,
    });
  }
}
