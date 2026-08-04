export type PasswordResetUseCaseConfig = {
  appOrigin: string;
  emailSendRateLimitMax: number;
  emailSendRateLimitWindowMinutes: number;
  passwordResetTokenTtlMinutes: number;
};
