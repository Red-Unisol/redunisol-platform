export type VerificationCodeHasher = {
  hash(code: string): string;
};
