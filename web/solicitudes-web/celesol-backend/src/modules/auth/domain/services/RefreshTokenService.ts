export type RefreshTokenService = {
  generate(): string;
  hash(token: string): string;
};
