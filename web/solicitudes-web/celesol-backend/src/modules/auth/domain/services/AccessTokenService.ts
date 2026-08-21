export type AccessTokenPayload = {
  userId: string;
};

export type AccessTokenService = {
  sign(payload: AccessTokenPayload): string;
  verify(token: string): AccessTokenPayload;
};
