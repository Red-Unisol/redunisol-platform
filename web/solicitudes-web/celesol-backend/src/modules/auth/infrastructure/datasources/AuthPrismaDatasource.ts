import { Prisma, type PrismaClient } from "@prisma/client";

import { AuthConflictError, UserNotFoundError } from "../../domain/auth-errors";
import { LOGIN_ALLOWED_USER_STATES, USER_STATE } from "../../domain/user-state";
import type {
  AuthUser,
  PersistedAuthUser,
} from "../../domain/entities/User.entity";
import { UserMapper } from "../mappers/User.mapper";

const activeUserWhere = {
  deletedAt: null,
  state: {
    in: [...LOGIN_ALLOWED_USER_STATES],
  },
};

export class AuthPrismaDatasource {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(input: {
    email: string;
    firstName: string;
    lastName: string;
    legacyUser: string;
    passwordHash: string;
    state?: number;
    workflowOwnerId?: string | null;
  }): Promise<AuthUser> {
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          legacyUser: input.legacyUser,
          passwordHash: input.passwordHash,
          state: input.state ?? USER_STATE.PENDING_AREA_ASSIGNMENT,
          ...(input.workflowOwnerId
            ? {
                workflowOwner: {
                  connect: {
                    id: input.workflowOwnerId,
                  },
                },
              }
            : {}),
        },
        select: UserMapper.profileSelect(),
      });

      return UserMapper.toDomain(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.join(",")
          : "";

        if (target.includes("usr_email")) {
          throw new AuthConflictError("Email already registered.");
        }

        if (target.includes("usr_legacy_user")) {
          throw new AuthConflictError("Legacy user already registered.");
        }

        throw new AuthConflictError("User already registered.");
      }

      throw error;
    }
  }

  async deleteById(userId: string) {
    await this.prisma.user.delete({
      where: {
        id: userId,
      },
    });
  }

  async findById(userId: string) {
    const user = await this.prisma.user.findFirst({
      select: UserMapper.profileSelect(),
      where: {
        deletedAt: null,
        id: userId,
      },
    });

    return user ? UserMapper.toDomain(user) : null;
  }

  async findByIdWithPasswordHash(
    userId: string,
  ): Promise<PersistedAuthUser | null> {
    const user = await this.prisma.user.findFirst({
      select: {
        ...UserMapper.profileSelect(),
        passwordHash: true,
      },
      where: {
        deletedAt: null,
        id: userId,
      },
    });

    return user
      ? {
          ...UserMapper.toDomain(user),
          passwordHash: user.passwordHash,
        }
      : null;
  }

  async countActiveSystemAdmins() {
    return this.prisma.user.count({
      where: {
        deletedAt: null,
        isSystemAdmin: true,
        state: USER_STATE.ACTIVE,
      },
    });
  }

  async updateUser(input: {
    id: string;
    email?: string;
    emailVerified?: boolean;
    firstName?: string;
    isSystemAdmin?: boolean;
    lastName?: string;
    legacyUser?: string;
    recibeAsignacionAutomatica?: boolean;
    state?: number;
  }): Promise<AuthUser> {
    try {
      const result = await this.prisma.user.updateMany({
        data: {
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.emailVerified !== undefined
            ? { emailVerified: input.emailVerified }
            : {}),
          ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
          ...(input.isSystemAdmin !== undefined
            ? { isSystemAdmin: input.isSystemAdmin }
            : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
          ...(input.legacyUser !== undefined ? { legacyUser: input.legacyUser } : {}),
          ...(input.recibeAsignacionAutomatica !== undefined
            ? { recibeAsignacionAutomatica: input.recibeAsignacionAutomatica }
            : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
        },
        where: {
          deletedAt: null,
          id: input.id,
        },
      });

      if (result.count === 0) {
        throw new UserNotFoundError();
      }

      const user = await this.findById(input.id);

      if (!user) {
        throw new UserNotFoundError();
      }

      return user;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.join(",")
          : "";

        if (target.includes("usr_email")) {
          throw new AuthConflictError("Email already registered.");
        }

        if (target.includes("usr_legacy_user")) {
          throw new AuthConflictError("Legacy user already registered.");
        }
      }

      throw error;
    }
  }

  async listUsers() {
    const users = await this.prisma.user.findMany({
      select: UserMapper.profileSelect(),
      where: {
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return users.map((user) => UserMapper.toDomain(user));
  }

  async listPendingAreaUsers() {
    const users = await this.prisma.user.findMany({
      select: UserMapper.profileSelect(),
      where: {
        deletedAt: null,
        state: USER_STATE.PENDING_AREA_ASSIGNMENT,
        workflowOwnerId: null,
      },
    });

    return users.map((user) => UserMapper.toDomain(user));
  }

  async findActiveById(userId: string) {
    const user = await this.prisma.user.findFirst({
      select: UserMapper.profileSelect(),
      where: {
        ...activeUserWhere,
        id: userId,
      },
    });

    return user ? UserMapper.toDomain(user) : null;
  }

  async findActiveByIdentifier(
    identifier: string,
  ): Promise<PersistedAuthUser | null> {
    const normalizedIdentifier = identifier.trim();
    const user = await this.prisma.user.findFirst({
      select: {
        ...UserMapper.profileSelect(),
        passwordHash: true,
      },
      where: {
        ...activeUserWhere,
        OR: [
          {
            email: {
              equals: normalizedIdentifier,
              mode: "insensitive",
            },
          },
          {
            legacyUser: {
              equals: normalizedIdentifier,
              mode: "insensitive",
            },
          },
        ],
      },
    });

    return user
      ? {
          ...UserMapper.toDomain(user),
          passwordHash: user.passwordHash,
        }
      : null;
  }

  async findByEmail(email: string) {
    const user = await this.prisma.user.findFirst({
      select: UserMapper.profileSelect(),
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
    });

    return user ? UserMapper.toDomain(user) : null;
  }

  async findByLegacyUser(legacyUser: string) {
    const user = await this.prisma.user.findFirst({
      select: UserMapper.profileSelect(),
      where: {
        legacyUser: {
          equals: legacyUser,
          mode: "insensitive",
        },
      },
    });

    return user ? UserMapper.toDomain(user) : null;
  }

  async existsOtherUserWithLegacyUser(input: {
    excludeUserId: string;
    legacyUser: string;
  }) {
    const duplicate = await this.prisma.user.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        id: {
          not: input.excludeUserId,
        },
        legacyUser: {
          equals: input.legacyUser,
          mode: "insensitive",
        },
      },
    });

    return duplicate !== null;
  }

  async listActiveWorkflowOwners() {
    return this.prisma.workflowOwner.findMany({
      select: {
        code: true,
        id: true,
        name: true,
      },
      where: {
        isActive: true,
      },
      orderBy: {
        sortOrder: "asc",
      },
    });
  }

  async assignWorkflowOwner(input: {
    userId: string;
    workflowOwnerId: string | null;
  }): Promise<AuthUser> {
    try {
      const user = await this.prisma.user.update({
        data: {
          workflowOwnerId: input.workflowOwnerId,
          ...(input.workflowOwnerId !== null
            ? { state: USER_STATE.ACTIVE }
            : { state: USER_STATE.PENDING_AREA_ASSIGNMENT }),
        },
        select: UserMapper.profileSelect(),
        where: {
          id: input.userId,
        },
      });

      return UserMapper.toDomain(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new UserNotFoundError();
      }

      throw error;
    }
  }

  async findActiveWorkflowOwnerById(workflowOwnerId: string) {
    return this.prisma.workflowOwner.findFirst({
      select: {
        id: true,
      },
      where: {
        id: workflowOwnerId,
        isActive: true,
      },
    });
  }

  async updatePasswordAndRevokeSessions(input: {
    userId: string;
    passwordHash: string;
  }): Promise<void> {
    const revokedAt = new Date();

    await this.prisma.$transaction(async (transaction) => {
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
          revokedAt,
        },
        where: {
          revokedAt: null,
          userId: input.userId,
        },
      });
    });
  }
}
