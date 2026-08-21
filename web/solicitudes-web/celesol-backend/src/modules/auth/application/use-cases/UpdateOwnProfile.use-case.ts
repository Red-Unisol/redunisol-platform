import {
  AuthConflictError,
  InvalidRequestError,
  UserNotFoundError,
} from "../../domain/auth-errors";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { EmailVerificationRepository } from "../../domain/repositories/EmailVerificationRepository";
import type { AccountVerificationEmailSender } from "../../domain/services/AccountVerificationEmailSender";
import type { EmailVerificationCodeGenerator } from "../../domain/services/EmailVerificationCodeGenerator";
import type { VerificationCodeHasher } from "../../domain/services/VerificationCodeHasher";
import type { UpdateOwnProfileInput } from "../dtos/UpdateOwnProfile.dto";
import type { AuthUseCaseConfig } from "./AuthUseCaseConfig";

type UpdateOwnProfileUseCaseDependencies = {
  accountVerificationEmailSender: AccountVerificationEmailSender;
  config: AuthUseCaseConfig;
  emailVerificationCodeGenerator: EmailVerificationCodeGenerator;
  emailVerificationRepository: EmailVerificationRepository;
  userRepository: AuthRepository;
  verificationCodeHasher: VerificationCodeHasher;
};

export class UpdateOwnProfileUseCase {
  private readonly accountVerificationEmailSender: AccountVerificationEmailSender;
  private readonly config: AuthUseCaseConfig;
  private readonly emailVerificationCodeGenerator: EmailVerificationCodeGenerator;
  private readonly emailVerificationRepository: EmailVerificationRepository;
  private readonly userRepository: AuthRepository;
  private readonly verificationCodeHasher: VerificationCodeHasher;

  constructor(dependencies: UpdateOwnProfileUseCaseDependencies) {
    this.accountVerificationEmailSender =
      dependencies.accountVerificationEmailSender;
    this.config = dependencies.config;
    this.emailVerificationCodeGenerator =
      dependencies.emailVerificationCodeGenerator;
    this.emailVerificationRepository = dependencies.emailVerificationRepository;
    this.userRepository = dependencies.userRepository;
    this.verificationCodeHasher = dependencies.verificationCodeHasher;
  }

  async execute(input: UpdateOwnProfileInput) {
    const targetUser = await this.userRepository.findById(input.userId);

    if (!targetUser) {
      throw new UserNotFoundError();
    }

    const normalizedFirstName =
      input.firstName === undefined ? undefined : input.firstName.trim();
    const normalizedLastName =
      input.lastName === undefined ? undefined : input.lastName.trim();
    const normalizedEmail =
      input.email === undefined ? undefined : input.email.trim().toLowerCase();

    if (input.firstName !== undefined) {
      if (normalizedFirstName === undefined || normalizedFirstName.length === 0) {
        throw new InvalidRequestError("Request body invalido.");
      }
    }

    if (input.lastName !== undefined) {
      if (normalizedLastName === undefined || normalizedLastName.length === 0) {
        throw new InvalidRequestError("Request body invalido.");
      }
    }

    if (input.email !== undefined) {
      if (normalizedEmail === undefined || normalizedEmail.length === 0) {
        throw new InvalidRequestError("Request body invalido.");
      }
    }

    const emailChanged =
      normalizedEmail !== undefined &&
      normalizedEmail !== targetUser.email.toLowerCase();

    if (emailChanged) {
      const existing = await this.userRepository.findByEmail(normalizedEmail!);

      if (existing && existing.id !== targetUser.id) {
        throw new AuthConflictError("Email already registered.");
      }
    }

    const updatedUser = await this.userRepository.updateUser({
      email: normalizedEmail,
      emailVerified: emailChanged ? false : undefined,
      firstName: normalizedFirstName,
      id: targetUser.id,
      lastName: normalizedLastName,
    });

    if (emailChanged) {
      await this.sendVerificationEmail(updatedUser.id, updatedUser.email);
    }

    return updatedUser;
  }

  private async sendVerificationEmail(userId: string, email: string) {
    try {
      const recentSends =
        await this.emailVerificationRepository.countCreatedSinceByUserId({
          since: this.addMinutes(
            new Date(),
            -this.config.emailSendRateLimitWindowMinutes,
          ),
          userId,
        });

      if (recentSends >= this.config.emailSendRateLimitMax) {
        return;
      }

      const verificationCode = this.emailVerificationCodeGenerator.generate();

      await this.emailVerificationRepository.createForUser({
        expiresAt: this.addMinutes(
          new Date(),
          this.config.emailVerificationCodeTtlMinutes,
        ),
        tokenHash: this.verificationCodeHasher.hash(verificationCode),
        userId,
      });
      await this.accountVerificationEmailSender.sendAccountVerificationEmail({
        code: verificationCode,
        to: email,
      });
    } catch {
      // El envío es best-effort: si falla, el usuario puede pedir un nuevo
      // código con POST /auth/resend-verification-code.
    }
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }
}
