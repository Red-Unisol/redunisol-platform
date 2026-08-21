import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { GetCurrentUserUseCase } from "./application/use-cases/GetCurrentUser.use-case";
import { AssignWorkflowOwnerUseCase } from "./application/use-cases/AssignWorkflowOwner.use-case";
import { LoginUserUseCase } from "./application/use-cases/LoginUser.use-case";
import { ListPendingAreaUsersUseCase } from "./application/use-cases/ListPendingAreaUsers.use-case";
import { ListUsersUseCase } from "./application/use-cases/ListUsers.use-case";
import { ListWorkflowOwnersUseCase } from "./application/use-cases/ListWorkflowOwners.use-case";
import { LogoutUserUseCase } from "./application/use-cases/LogoutUser.use-case";
import { RegisterUserUseCase } from "./application/use-cases/RegisterUser.use-case";
import { ResendVerificationCodeUseCase } from "./application/use-cases/ResendVerificationCode.use-case";
import { RefreshSessionUseCase } from "./application/use-cases/RefreshSession.use-case";
import { RequestPasswordResetUseCase } from "./application/use-cases/RequestPasswordReset.use-case";
import { ResetPasswordUseCase } from "./application/use-cases/ResetPassword.use-case";
import { VerifyEmailUseCase } from "./application/use-cases/VerifyEmail.use-case";
import { UpdateUserUseCase } from "./application/use-cases/UpdateUser.use-case";
import { UpdateOwnProfileUseCase } from "./application/use-cases/UpdateOwnProfile.use-case";
import { ChangeOwnPasswordUseCase } from "./application/use-cases/ChangeOwnPassword.use-case";
import { AuthPrismaDatasource } from "./infrastructure/datasources/AuthPrismaDatasource";
import { EmailVerificationPrismaDatasource } from "./infrastructure/datasources/EmailVerificationPrismaDatasource";
import { PasswordResetPrismaDatasource } from "./infrastructure/datasources/PasswordResetPrismaDatasource";
import { RefreshTokenPrismaDatasource } from "./infrastructure/datasources/RefreshTokenPrismaDatasource";
import { AuthRepositoryImpl } from "./infrastructure/repositories/AuthRepositoryImpl";
import { EmailVerificationRepositoryImpl } from "./infrastructure/repositories/EmailVerificationRepositoryImpl";
import { PasswordResetRepositoryImpl } from "./infrastructure/repositories/PasswordResetRepositoryImpl";
import { RefreshTokenRepositoryImpl } from "./infrastructure/repositories/RefreshTokenRepositoryImpl";
import { BcryptPasswordHasher } from "./infrastructure/services/BcryptPasswordHasher";
import { ConsoleAccountVerificationSender } from "./infrastructure/services/ConsoleAccountVerificationSender";
import { ConsolePasswordResetEmailSender } from "./infrastructure/services/ConsolePasswordResetEmailSender";
import { EmailServiceAccountVerificationSender } from "./infrastructure/services/EmailServiceAccountVerificationSender";
import { EmailServicePasswordResetSender } from "./infrastructure/services/EmailServicePasswordResetSender";
import { EvaluateListLegacyUserVerifier } from "./infrastructure/services/EvaluateListLegacyUserVerifier";
import { JwtTokenService } from "./infrastructure/services/JwtTokenService";
import { OpaquePasswordResetTokenService } from "./infrastructure/services/OpaquePasswordResetTokenService";
import { OpaqueRefreshTokenService } from "./infrastructure/services/OpaqueRefreshTokenService";
import { RandomEmailVerificationCodeGenerator } from "./infrastructure/services/RandomEmailVerificationCodeGenerator";
import { Sha256VerificationCodeHasher } from "./infrastructure/services/Sha256VerificationCodeHasher";
import { AuthController } from "./presentation/AuthController";
import { AuthRoutes } from "./presentation/AuthRoutes";
import { UsersRoutes } from "./presentation/UsersRoutes";
import { emailService } from "../email/email-module";

const authDatasource = new AuthPrismaDatasource(prisma);
const emailVerificationDatasource = new EmailVerificationPrismaDatasource(
  prisma,
);
const passwordResetDatasource = new PasswordResetPrismaDatasource(prisma);
const refreshTokenDatasource = new RefreshTokenPrismaDatasource(prisma);
const authRepository = new AuthRepositoryImpl(authDatasource);
const emailVerificationRepository = new EmailVerificationRepositoryImpl(
  emailVerificationDatasource,
);
const passwordResetRepository = new PasswordResetRepositoryImpl(
  passwordResetDatasource,
);
const refreshTokenRepository = new RefreshTokenRepositoryImpl(
  refreshTokenDatasource,
);
const accessTokenService = new JwtTokenService({
  secret: env.ACCESS_TOKEN_SECRET,
  ttlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
});
const refreshTokenService = new OpaqueRefreshTokenService();
const passwordResetTokenService = new OpaquePasswordResetTokenService();
const passwordHasher = new BcryptPasswordHasher();
const emailVerificationCodeGenerator =
  new RandomEmailVerificationCodeGenerator();
const verificationCodeHasher = new Sha256VerificationCodeHasher();
const accountVerificationEmailSender = env.MAIL_ENABLED
  ? new EmailServiceAccountVerificationSender(emailService)
  : new ConsoleAccountVerificationSender();
const passwordResetEmailSender = env.MAIL_ENABLED
  ? new EmailServicePasswordResetSender(emailService)
  : new ConsolePasswordResetEmailSender();
const legacyUserVerifier = new EvaluateListLegacyUserVerifier({
  baseUrl: env.LEGACY_API_BASE_URL,
  timeoutMs: env.LEGACY_API_TIMEOUT_MS,
});
const authUseCaseConfig = {
  accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
  emailVerificationCodeTtlMinutes: env.EMAIL_VERIFICATION_CODE_TTL_MINUTES,
  emailSendRateLimitMax: env.EMAIL_SEND_RATE_LIMIT_MAX,
  emailSendRateLimitWindowMinutes: env.EMAIL_SEND_RATE_LIMIT_WINDOW_MINUTES,
  refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
};
const passwordResetUseCaseConfig = {
  appOrigin: env.APP_ORIGIN,
  emailSendRateLimitMax: env.EMAIL_SEND_RATE_LIMIT_MAX,
  emailSendRateLimitWindowMinutes: env.EMAIL_SEND_RATE_LIMIT_WINDOW_MINUTES,
  passwordResetTokenTtlMinutes: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
};

const loginUserUseCase = new LoginUserUseCase({
  accessTokenService,
  config: authUseCaseConfig,
  passwordHasher,
  refreshTokenRepository,
  refreshTokenService,
  userRepository: authRepository,
});
const registerUserUseCase = new RegisterUserUseCase({
  accountVerificationEmailSender,
  config: authUseCaseConfig,
  emailVerificationCodeGenerator,
  emailVerificationRepository,
  legacyUserVerifier,
  passwordHasher,
  userRepository: authRepository,
  verificationCodeHasher,
});
const assignWorkflowOwnerUseCase = new AssignWorkflowOwnerUseCase({
  userRepository: authRepository,
});
const listUsersUseCase = new ListUsersUseCase({
  userRepository: authRepository,
});
const listPendingAreaUsersUseCase = new ListPendingAreaUsersUseCase({
  userRepository: authRepository,
});
const listWorkflowOwnersUseCase = new ListWorkflowOwnersUseCase({
  userRepository: authRepository,
});
const updateUserUseCase = new UpdateUserUseCase({
  userRepository: authRepository,
});
const updateOwnProfileUseCase = new UpdateOwnProfileUseCase({
  accountVerificationEmailSender,
  config: authUseCaseConfig,
  emailVerificationCodeGenerator,
  emailVerificationRepository,
  userRepository: authRepository,
  verificationCodeHasher,
});
const changeOwnPasswordUseCase = new ChangeOwnPasswordUseCase({
  passwordHasher,
  userRepository: authRepository,
});
const verifyEmailUseCase = new VerifyEmailUseCase({
  emailVerificationRepository,
  userRepository: authRepository,
  verificationCodeHasher,
});
const resendVerificationCodeUseCase = new ResendVerificationCodeUseCase({
  accountVerificationEmailSender,
  config: authUseCaseConfig,
  emailVerificationCodeGenerator,
  emailVerificationRepository,
  userRepository: authRepository,
  verificationCodeHasher,
});
const requestPasswordResetUseCase = new RequestPasswordResetUseCase({
  config: passwordResetUseCaseConfig,
  passwordResetEmailSender,
  passwordResetRepository,
  passwordResetTokenService,
});
const resetPasswordUseCase = new ResetPasswordUseCase({
  passwordHasher,
  passwordResetRepository,
  passwordResetTokenService,
});
const refreshSessionUseCase = new RefreshSessionUseCase({
  accessTokenService,
  config: authUseCaseConfig,
  refreshTokenRepository,
  refreshTokenService,
  userRepository: authRepository,
});
const logoutUserUseCase = new LogoutUserUseCase({
  refreshTokenRepository,
  refreshTokenService,
});
export const getCurrentUserUseCase = new GetCurrentUserUseCase({
  accessTokenService,
  userRepository: authRepository,
});

const authController = new AuthController({
  authCookieConfig: {
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
    isProduction: env.NODE_ENV === "production",
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  },
  assignWorkflowOwnerUseCase,
  getCurrentUserUseCase,
  listUsersUseCase,
  listPendingAreaUsersUseCase,
  listWorkflowOwnersUseCase,
  loginUserUseCase,
  logoutUserUseCase,
  registerUserUseCase,
  resendVerificationCodeUseCase,
  refreshSessionUseCase,
  requestPasswordResetUseCase,
  resetPasswordUseCase,
  updateUserUseCase,
  updateOwnProfileUseCase,
  changeOwnPasswordUseCase,
  verifyEmailUseCase,
});

export const authRouter = AuthRoutes.create(authController);
export const usersRouter = UsersRoutes.create(authController);
