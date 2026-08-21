import type { AuthUser } from "./User.entity";

export type EmailVerificationTokenRecord = {
  expiresAt: Date;
  id: string;
  tokenHash: string;
  usedAt: Date | null;
  user: AuthUser;
  userId: string;
};
