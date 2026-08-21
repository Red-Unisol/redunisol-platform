export type AuthUseCaseConfig = {
  accessTokenTtlMinutes: number;
  emailVerificationCodeTtlMinutes: number;
  emailSendRateLimitMax: number;
  emailSendRateLimitWindowMinutes: number;
  refreshTokenTtlDays: number;
};
