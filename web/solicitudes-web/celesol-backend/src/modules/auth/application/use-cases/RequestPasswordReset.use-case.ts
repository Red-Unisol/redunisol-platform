import type { PasswordResetRepository } from "../../domain/repositories/PasswordResetRepository";
import type { PasswordResetEmailSender } from "../../domain/services/PasswordResetEmailSender";
import type { PasswordResetTokenService } from "../../domain/services/PasswordResetTokenService";
import { TooManyEmailRequestsError } from "../../domain/auth-errors";
import type { RequestPasswordResetDto } from "../dtos/RequestPasswordReset.dto";
import type { PasswordResetUseCaseConfig } from "./PasswordResetUseCaseConfig";

type RequestPasswordResetUseCaseDependencies = {
  config: PasswordResetUseCaseConfig;
  passwordResetEmailSender: PasswordResetEmailSender;
  passwordResetRepository: PasswordResetRepository;
  passwordResetTokenService: PasswordResetTokenService;
};

export class RequestPasswordResetUseCase {
  private readonly config: PasswordResetUseCaseConfig;
  private readonly passwordResetEmailSender: PasswordResetEmailSender;
  private readonly passwordResetRepository: PasswordResetRepository;
  private readonly passwordResetTokenService: PasswordResetTokenService;

  constructor(dependencies: RequestPasswordResetUseCaseDependencies) {
    this.config = dependencies.config;
    this.passwordResetEmailSender = dependencies.passwordResetEmailSender;
    this.passwordResetRepository = dependencies.passwordResetRepository;
    this.passwordResetTokenService = dependencies.passwordResetTokenService;
  }

  async execute(input: RequestPasswordResetDto): Promise<void> {
    const user = await this.passwordResetRepository.findActiveUserByEmail(
      input.email,
    );

    if (!user) {
      return;
    }
    const recentSends =
      await this.passwordResetRepository.countCreatedSinceByUserId({
        since: this.addMinutes(
          new Date(),
          -this.config.emailSendRateLimitWindowMinutes,
        ),
        userId: user.id,
      });

    if (recentSends >= this.config.emailSendRateLimitMax) {
      throw new TooManyEmailRequestsError();
    }

    const token = this.passwordResetTokenService.generate();
    const tokenHash = this.passwordResetTokenService.hash(token);
    const resetUrl = this.buildResetUrl(token);

    try {
      await this.passwordResetRepository.createForUser({
        expiresAt: this.addMinutes(
          new Date(),
          this.config.passwordResetTokenTtlMinutes,
        ),
        tokenHash,
        userId: user.id,
      });
      await this.passwordResetEmailSender.sendPasswordResetEmail({
        resetUrl,
        to: user.email,
      });
    } catch {
      return;
    }
  }

  private buildResetUrl(token: string) {
    const url = new URL("/reset-password", this.config.appOrigin);
    url.searchParams.set("token", token);
    return url.toString();
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }
}
