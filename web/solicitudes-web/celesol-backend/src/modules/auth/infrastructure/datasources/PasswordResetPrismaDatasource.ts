import type { PrismaClient } from "@prisma/client";

import type { AuthUser } from "../../domain/entities/User.entity";
import { LOGIN_ALLOWED_USER_STATES } from "../../domain/user-state";
import { PasswordResetTokenMapper } from "../mappers/PasswordResetToken.mapper";
import { UserMapper } from "../mappers/User.mapper";

const activeUserWhere = {
  deletedAt: null,
  state: {
    in: [...LOGIN_ALLOWED_USER_STATES],
  },
};

export class PasswordResetPrismaDatasource {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createForUser(input: {
    expiresAt: Date;
    tokenHash: string;
    userId: string;
  }) {
    await this.prisma.passwordResetToken.create({
      data: {
        expiresAt: input.expiresAt,
        tokenHash: input.tokenHash,
        userId: input.userId,
      },
    });
  }

  async countCreatedSinceByUserId(input: { since: Date; userId: string }) {
    return await this.prisma.passwordResetToken.count({
      where: {
        createdAt: {
          gte: input.since,
        },
        userId: input.userId,
      },
    });
  }

  async findActiveUserByEmail(email: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findFirst({
      select: UserMapper.profileSelect(),
      where: {
        ...activeUserWhere,
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
    });

    return user ? UserMapper.toDomain(user) : null;
  }

  async findValidByHash(input: { now: Date; tokenHash: string }) {
    const token = await this.prisma.passwordResetToken.findFirst({
      include: {
        user: {
          select: UserMapper.profileSelect(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      where: {
        expiresAt: {
          gt: input.now,
        },
        tokenHash: input.tokenHash,
        usedAt: null,
        user: activeUserWhere,
      },
    });

    return token ? PasswordResetTokenMapper.toDomain(token) : null;
  }

  async resetPasswordAndRevokeSessions(input: {
    passwordHash: string;
    tokenId: string;
    usedAt: Date;
    userId: string;
  }) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.passwordResetToken.update({
        data: {
          usedAt: input.usedAt,
        },
        where: {
          id: input.tokenId,
        },
      });
      await transaction.user.update({
        data: {
          passwordHash: input.passwordHash,
        },
        where: {
          id: input.userId,
        },
      });
      await transaction.refreshToken.updateMany({
        data: {
          revokedAt: input.usedAt,
        },
        where: {
          revokedAt: null,
          userId: input.userId,
        },
      });
    });
  }
}
