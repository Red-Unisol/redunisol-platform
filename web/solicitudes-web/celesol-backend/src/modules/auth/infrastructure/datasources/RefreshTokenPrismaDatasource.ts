import type { PrismaClient } from "@prisma/client";

import type { RequestMetadata } from "../../domain/entities/RefreshToken.entity";
import { RefreshTokenMapper } from "../mappers/RefreshToken.mapper";
import { UserMapper } from "../mappers/User.mapper";

export class RefreshTokenPrismaDatasource {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(input: {
    expiresAt: Date;
    metadata: RequestMetadata;
    tokenHash: string;
    userId: string;
  }) {
    await this.prisma.refreshToken.create({
      data: {
        expiresAt: input.expiresAt,
        ipAddress: input.metadata.ipAddress,
        tokenHash: input.tokenHash,
        userAgent: input.metadata.userAgent,
        userId: input.userId,
      },
    });
  }

  async findByHash(tokenHash: string) {
    const token = await this.prisma.refreshToken.findUnique({
      include: {
        user: {
          select: UserMapper.profileSelect(),
        },
      },
      where: {
        tokenHash,
      },
    });

    return token ? RefreshTokenMapper.toDomain(token) : null;
  }

  async revoke(tokenHash: string, replacedByTokenHash?: string) {
    await this.prisma.refreshToken.updateMany({
      data: {
        replacedByTokenHash,
        revokedAt: new Date(),
      },
      where: {
        revokedAt: null,
        tokenHash,
      },
    });
  }

  async rotate(input: {
    currentTokenHash: string;
    expiresAt: Date;
    metadata: RequestMetadata;
    newTokenHash: string;
    userId: string;
  }) {
    return await this.prisma.$transaction(async (transaction) => {
      const revokedToken = await transaction.refreshToken.updateMany({
        data: {
          replacedByTokenHash: input.newTokenHash,
          revokedAt: new Date(),
        },
        where: {
          revokedAt: null,
          tokenHash: input.currentTokenHash,
        },
      });

      if (revokedToken.count === 0) {
        return false;
      }

      await transaction.refreshToken.create({
        data: {
          expiresAt: input.expiresAt,
          ipAddress: input.metadata.ipAddress,
          tokenHash: input.newTokenHash,
          userAgent: input.metadata.userAgent,
          userId: input.userId,
        },
      });

      return true;
    });
  }
}
