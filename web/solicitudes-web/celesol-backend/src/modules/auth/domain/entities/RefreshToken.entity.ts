import type { AuthUser } from "./User.entity";

export type RequestMetadata = {
  ipAddress?: string;
  userAgent?: string;
};

export type RefreshTokenRecord = {
  expiresAt: Date;
  id: string;
  revokedAt: Date | null;
  tokenHash: string;
  user: AuthUser;
  userId: string;
};

export function isRefreshTokenActive(token: RefreshTokenRecord, now: Date) {
  return token.revokedAt === null && token.expiresAt > now;
}
