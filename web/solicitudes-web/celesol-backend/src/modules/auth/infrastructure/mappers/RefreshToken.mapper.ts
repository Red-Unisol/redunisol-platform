import type { RefreshTokenRecord } from "../../domain/entities/RefreshToken.entity";
import { UserMapper, type PrismaUserShape } from "./User.mapper";

export type PrismaRefreshTokenShape = {
  expiresAt: Date;
  id: string;
  revokedAt: Date | null;
  tokenHash: string;
  user: PrismaUserShape;
  userId: string;
};

export class RefreshTokenMapper {
  static toDomain(token: PrismaRefreshTokenShape): RefreshTokenRecord {
    return {
      expiresAt: token.expiresAt,
      id: token.id,
      revokedAt: token.revokedAt,
      tokenHash: token.tokenHash,
      user: UserMapper.toDomain(token.user),
      userId: token.userId,
    };
  }
}
