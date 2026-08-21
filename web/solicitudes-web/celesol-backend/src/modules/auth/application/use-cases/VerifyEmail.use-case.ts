import type { AuthUser } from "../../domain/entities/User.entity";
import { InvalidEmailVerificationCodeError } from "../../domain/auth-errors";
import type { EmailVerificationRepository } from "../../domain/repositories/EmailVerificationRepository";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { VerificationCodeHasher } from "../../domain/services/VerificationCodeHasher";
import type { VerifyEmailDto } from "../dtos/VerifyEmail.dto";

type VerifyEmailUseCaseDependencies = {
  emailVerificationRepository: EmailVerificationRepository;
  userRepository: AuthRepository;
  verificationCodeHasher: VerificationCodeHasher;
};

export class VerifyEmailUseCase {
  private readonly emailVerificationRepository: EmailVerificationRepository;
  private readonly userRepository: AuthRepository;
  private readonly verificationCodeHasher: VerificationCodeHasher;

  constructor(dependencies: VerifyEmailUseCaseDependencies) {
    this.emailVerificationRepository =
      dependencies.emailVerificationRepository;
    this.userRepository = dependencies.userRepository;
    this.verificationCodeHasher = dependencies.verificationCodeHasher;
  }

  async execute(input: VerifyEmailDto): Promise<AuthUser> {
    const user = await this.userRepository.findActiveByIdentifier(
      input.identifier,
    );

    if (!user) {
      throw new InvalidEmailVerificationCodeError();
    }

    const tokenHash = this.verificationCodeHasher.hash(input.code);
    const token =
      await this.emailVerificationRepository.findValidByEmailAndHash({
        email: user.email,
        now: new Date(),
        tokenHash,
      });

    if (!token) {
      throw new InvalidEmailVerificationCodeError();
    }

    return await this.emailVerificationRepository.markUsedAndVerifyUser({
      tokenId: token.id,
      usedAt: new Date(),
      userId: token.userId,
    });
  }
}
