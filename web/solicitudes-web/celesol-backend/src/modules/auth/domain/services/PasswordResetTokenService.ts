export type PasswordResetTokenService = {
  generate(): string;
  hash(token: string): string;
};
