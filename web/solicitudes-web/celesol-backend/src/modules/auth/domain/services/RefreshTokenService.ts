export type RefreshTokenService = {
  successor(token: string): string;
  generate(): string;
  hash(token: string): string;
};
