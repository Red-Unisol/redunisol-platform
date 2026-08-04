import {
  AuthConflictError,
  LegacyUserInactiveError,
  LegacyUserNotFoundError,
} from "../../domain/auth-errors";
import type { EmailVerificationRepository } from "../../domain/repositories/EmailVerificationRepository";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { AccountVerificationEmailSender } from "../../domain/services/AccountVerificationEmailSender";
import type { EmailVerificationCodeGenerator } from "../../domain/services/EmailVerificationCodeGenerator";
import type { LegacyUserVerifier } from "../../domain/services/LegacyUserVerifier";
import type { PasswordHasher } from "../../domain/services/PasswordHasher";
import type { VerificationCodeHasher } from "../../domain/services/VerificationCodeHasher";
import { USER_STATE } from "../../domain/user-state";
import type {
  RegisterUserDto,
  RegisterUserResultDto,
} from "../dtos/RegisterUser.dto";
import type { AuthUseCaseConfig } from "./AuthUseCaseConfig";

type RegisterUserUseCaseDependencies = {
  accountVerificationEmailSender: AccountVerificationEmailSender;
  config: AuthUseCaseConfig;
  emailVerificationCodeGenerator: EmailVerificationCodeGenerator;
  emailVerificationRepository: EmailVerificationRepository;
  legacyUserVerifier: LegacyUserVerifier;
  passwordHasher: PasswordHasher;
  userRepository: AuthRepository;
  verificationCodeHasher: VerificationCodeHasher;
};

export class RegisterUserUseCase {
  private readonly accountVerificationEmailSender: AccountVerificationEmailSender;
  private readonly config: AuthUseCaseConfig;
  private readonly emailVerificationCodeGenerator: EmailVerificationCodeGenerator;
  private readonly emailVerificationRepository: EmailVerificationRepository;
  private readonly legacyUserVerifier: LegacyUserVerifier;
  private readonly passwordHasher: PasswordHasher;
  private readonly userRepository: AuthRepository;
  private readonly verificationCodeHasher: VerificationCodeHasher;

  constructor(dependencies: RegisterUserUseCaseDependencies) {
    this.accountVerificationEmailSender =
      dependencies.accountVerificationEmailSender;
    this.config = dependencies.config;
    this.emailVerificationCodeGenerator =
      dependencies.emailVerificationCodeGenerator;
    this.emailVerificationRepository =
      dependencies.emailVerificationRepository;
    this.legacyUserVerifier = dependencies.legacyUserVerifier;
    this.passwordHasher = dependencies.passwordHasher;
    this.userRepository = dependencies.userRepository;
    this.verificationCodeHasher = dependencies.verificationCodeHasher;
  }

  async execute(input: RegisterUserDto): Promise<RegisterUserResultDto> {
    const existingEmail = await this.userRepository.findByEmail(input.email);

    if (existingEmail) {
      throw new AuthConflictError("Email already registered.");
    }

    const existingLegacyUser = await this.userRepository.findByLegacyUser(
      input.legacyUser,
    );

    if (existingLegacyUser) {
      throw new AuthConflictError("Legacy user already registered.");
    }

    const legacyUser = await this.legacyUserVerifier.verifyByUserName(
      input.legacyUser,
    );

    if (!legacyUser) {
      throw new LegacyUserNotFoundError();
    }

    if (!legacyUser.active) {
      throw new LegacyUserInactiveError();
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    const verificationCode = this.emailVerificationCodeGenerator.generate();
    const tokenHash = this.verificationCodeHasher.hash(verificationCode);
    const user = await this.userRepository.create({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      legacyUser: input.legacyUser,
      passwordHash,
      state: USER_STATE.PENDING_AREA_ASSIGNMENT,
      workflowOwnerId: null,
    });

    try {
      await this.emailVerificationRepository.createForUser({
        expiresAt: this.addMinutes(
          new Date(),
          this.config.emailVerificationCodeTtlMinutes,
        ),
        tokenHash,
        userId: user.id,
      });
      await this.accountVerificationEmailSender.sendAccountVerificationEmail({
        code: verificationCode,
        to: user.email,
      });

      return {
        user,
        verificationEmailSent: true,
      };
    } catch {
      return {
        user,
        verificationEmailSent: false,
      };
    }
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }
}
