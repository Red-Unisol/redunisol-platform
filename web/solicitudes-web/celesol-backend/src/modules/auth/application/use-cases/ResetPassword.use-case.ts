import { InvalidPasswordResetTokenError } from "../../domain/auth-errors";
import type { PasswordResetRepository } from "../../domain/repositories/PasswordResetRepository";
import type { PasswordHasher } from "../../domain/services/PasswordHasher";
import type { PasswordResetTokenService } from "../../domain/services/PasswordResetTokenService";
import type { ResetPasswordDto } from "../dtos/ResetPassword.dto";

type ResetPasswordUseCaseDependencies = {
  passwordHasher: PasswordHasher;
  passwordResetRepository: PasswordResetRepository;
  passwordResetTokenService: PasswordResetTokenService;
};

export class ResetPasswordUseCase {
  private readonly passwordHasher: PasswordHasher;
  private readonly passwordResetRepository: PasswordResetRepository;
  private readonly passwordResetTokenService: PasswordResetTokenService;

  constructor(dependencies: ResetPasswordUseCaseDependencies) {
    this.passwordHasher = dependencies.passwordHasher;
    this.passwordResetRepository = dependencies.passwordResetRepository;
    this.passwordResetTokenService = dependencies.passwordResetTokenService;
  }

  async execute(input: ResetPasswordDto): Promise<void> {
    const tokenHash = this.passwordResetTokenService.hash(input.token);
    const token = await this.passwordResetRepository.findValidByHash({
      now: new Date(),
      tokenHash,
    });

    if (!token) {
      throw new InvalidPasswordResetTokenError();
    }

    const passwordHash = await this.passwordHasher.hash(input.password);

    await this.passwordResetRepository.resetPasswordAndRevokeSessions({
      passwordHash,
      tokenId: token.id,
      usedAt: new Date(),
      userId: token.userId,
    });
  }
}
