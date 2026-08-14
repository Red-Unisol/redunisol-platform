import type { ResendVerificationCodeDto } from "../dtos/ResendVerificationCode.dto";
import type { AuthUseCaseConfig } from "./AuthUseCaseConfig";
import {
  EmailDeliveryError,
  TooManyEmailRequestsError,
} from "../../domain/auth-errors";
import type { EmailVerificationRepository } from "../../domain/repositories/EmailVerificationRepository";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { AccountVerificationEmailSender } from "../../domain/services/AccountVerificationEmailSender";
import type { EmailVerificationCodeGenerator } from "../../domain/services/EmailVerificationCodeGenerator";
import type { VerificationCodeHasher } from "../../domain/services/VerificationCodeHasher";

type ResendVerificationCodeUseCaseDependencies = {
  accountVerificationEmailSender: AccountVerificationEmailSender;
  config: AuthUseCaseConfig;
  emailVerificationCodeGenerator: EmailVerificationCodeGenerator;
  emailVerificationRepository: EmailVerificationRepository;
  userRepository: AuthRepository;
  verificationCodeHasher: VerificationCodeHasher;
};

export class ResendVerificationCodeUseCase {
  private readonly accountVerificationEmailSender: AccountVerificationEmailSender;
  private readonly config: AuthUseCaseConfig;
  private readonly emailVerificationCodeGenerator: EmailVerificationCodeGenerator;
  private readonly emailVerificationRepository: EmailVerificationRepository;
  private readonly userRepository: AuthRepository;
  private readonly verificationCodeHasher: VerificationCodeHasher;

  constructor(dependencies: ResendVerificationCodeUseCaseDependencies) {
    this.accountVerificationEmailSender =
      dependencies.accountVerificationEmailSender;
    this.config = dependencies.config;
    this.emailVerificationCodeGenerator =
      dependencies.emailVerificationCodeGenerator;
    this.emailVerificationRepository =
      dependencies.emailVerificationRepository;
    this.userRepository = dependencies.userRepository;
    this.verificationCodeHasher = dependencies.verificationCodeHasher;
  }

  async execute(input: ResendVerificationCodeDto): Promise<void> {
    const user = await this.userRepository.findActiveByIdentifier(
      input.identifier,
    );

    if (!user || user.emailVerified) {
      return;
    }
    const recentSends =
      await this.emailVerificationRepository.countCreatedSinceByUserId({
        since: this.addMinutes(
          new Date(),
          -this.config.emailSendRateLimitWindowMinutes,
        ),
        userId: user.id,
      });

    if (recentSends >= this.config.emailSendRateLimitMax) {
      throw new TooManyEmailRequestsError();
    }

    const verificationCode = this.emailVerificationCodeGenerator.generate();

    await this.emailVerificationRepository.createForUser({
      expiresAt: this.addMinutes(
        new Date(),
        this.config.emailVerificationCodeTtlMinutes,
      ),
      tokenHash: this.verificationCodeHasher.hash(verificationCode),
      userId: user.id,
    });

    try {
      await this.accountVerificationEmailSender.sendAccountVerificationEmail({
        code: verificationCode,
        to: user.email,
      });
    } catch {
      throw new EmailDeliveryError();
    }
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }
}
