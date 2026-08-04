import type { AuthUser } from "../entities/User.entity";
import type { EmailVerificationTokenRecord } from "../entities/EmailVerificationToken.entity";

export type EmailVerificationRepository = {
  countCreatedSinceByUserId(input: {
    since: Date;
    userId: string;
  }): Promise<number>;
  createForUser(input: {
    expiresAt: Date;
    tokenHash: string;
    userId: string;
  }): Promise<void>;
  findValidByEmailAndHash(input: {
    email: string;
    now: Date;
    tokenHash: string;
  }): Promise<EmailVerificationTokenRecord | null>;
  markUsedAndVerifyUser(input: {
    tokenId: string;
    usedAt: Date;
    userId: string;
  }): Promise<AuthUser>;
};
