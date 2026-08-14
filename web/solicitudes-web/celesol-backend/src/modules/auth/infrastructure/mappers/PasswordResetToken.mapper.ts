import type { PasswordResetTokenRecord } from "../../domain/entities/PasswordResetToken.entity";
import { UserMapper, type PrismaUserShape } from "./User.mapper";

export type PrismaPasswordResetTokenShape = {
  expiresAt: Date;
  id: string;
  tokenHash: string;
  usedAt: Date | null;
  user: PrismaUserShape;
  userId: string;
};

export class PasswordResetTokenMapper {
  static toDomain(
    token: PrismaPasswordResetTokenShape,
  ): PasswordResetTokenRecord {
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
