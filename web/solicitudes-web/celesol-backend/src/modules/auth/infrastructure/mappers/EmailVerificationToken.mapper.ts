import type { EmailVerificationTokenRecord } from "../../domain/entities/EmailVerificationToken.entity";
import { UserMapper, type PrismaUserShape } from "./User.mapper";

export type PrismaEmailVerificationTokenShape = {
  expiresAt: Date;
  id: string;
  tokenHash: string;
  usedAt: Date | null;
  user: PrismaUserShape;
  userId: string;
};

export class EmailVerificationTokenMapper {
  static toDomain(
    token: PrismaEmailVerificationTokenShape,
  ): EmailVerificationTokenRecord {
    return {
      expiresAt: token.expiresAt,
      id: token.id,
      tokenHash: token.tokenHash,
      usedAt: token.usedAt,
      user: UserMapper.toDomain(token.user),
      userId: token.userId,
    };
  }
}
