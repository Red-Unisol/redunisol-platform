import type { AuthUser } from "../entities/User.entity";
import type { PasswordResetTokenRecord } from "../entities/PasswordResetToken.entity";

export type PasswordResetRepository = {
  countCreatedSinceByUserId(input: {
    since: Date;
    userId: string;
  }): Promise<number>;
  createForUser(input: {
    expiresAt: Date;
    tokenHash: string;
    userId: string;
  }): Promise<void>;
  findActiveUserByEmail(email: string): Promise<AuthUser | null>;
  findValidByHash(input: {
    now: Date;
    tokenHash: string;
  }): Promise<PasswordResetTokenRecord | null>;
  resetPasswordAndRevokeSessions(input: {
    passwordHash: string;
    tokenId: string;
    usedAt: Date;
    userId: string;
  }): Promise<void>;
};
