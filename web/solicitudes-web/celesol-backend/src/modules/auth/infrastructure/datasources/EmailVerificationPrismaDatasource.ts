import type { PrismaClient } from "@prisma/client";

import type { AuthUser } from "../../domain/entities/User.entity";
import { EmailVerificationTokenMapper } from "../mappers/EmailVerificationToken.mapper";
import { UserMapper } from "../mappers/User.mapper";

export class EmailVerificationPrismaDatasource {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createForUser(input: {
    expiresAt: Date;
    tokenHash: string;
    userId: string;
  }) {
    await this.prisma.emailVerificationToken.create({
      data: {
        expiresAt: input.expiresAt,
        tokenHash: input.tokenHash,
        userId: input.userId,
      },
    });
  }

  async countCreatedSinceByUserId(input: { since: Date; userId: string }) {
    return await this.prisma.emailVerificationToken.count({
      where: {
        createdAt: {
          gte: input.since,
        },
        userId: input.userId,
      },
    });
  }

  async findValidByEmailAndHash(input: {
    email: string;
    now: Date;
    tokenHash: string;
  }) {
    const token = await this.prisma.emailVerificationToken.findFirst({
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
        user: {
          email: {
            equals: input.email,
            mode: "insensitive",
          },
        },
      },
    });

    return token ? EmailVerificationTokenMapper.toDomain(token) : null;
  }

  async markUsedAndVerifyUser(input: {
    tokenId: string;
    usedAt: Date;
    userId: string;
  }): Promise<AuthUser> {
    return await this.prisma.$transaction(async (transaction) => {
      await transaction.emailVerificationToken.update({
        data: {
          usedAt: input.usedAt,
        },
        where: {
          id: input.tokenId,
        },
      });
      const user = await transaction.user.update({
        data: {
          emailVerified: true,
        },
        select: UserMapper.profileSelect(),
        where: {
          id: input.userId,
        },
      });

      return UserMapper.toDomain(user);
    });
  }
}
