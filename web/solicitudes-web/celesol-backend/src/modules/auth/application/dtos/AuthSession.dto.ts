import type { AuthUser } from "../../domain/entities/User.entity";

export type AuthTokens = {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

export type AuthSessionDto = {
  tokens: AuthTokens;
  user: AuthUser;
};
