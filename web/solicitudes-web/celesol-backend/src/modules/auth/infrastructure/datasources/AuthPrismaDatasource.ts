import { Prisma, type PrismaClient } from "@prisma/client";

import type { AssignWorkflowOwnerInput, PendingAreaAssignment } from "../../domain/workflow-areas";
import { cumulativeWorkflowCodes } from "../../domain/workflow-areas";
import { AuthConflictError, InvalidRequestError, UserNotFoundError, WorkflowOwnerNotFoundOrInactiveError } from "../../domain/auth-errors";
import { LOGIN_ALLOWED_USER_STATES, USER_STATE } from "../../domain/user-state";
import type {
  AuthUser,
  PersistedAuthUser,
} from "../../domain/entities/User.entity";
import { UserMapper } from "../mappers/User.mapper";

const pendingAreaAssignments = {
  where: { pendingReassignmentAreaId: { not: null }, archivedAt: null, estadoActual: { isTerminal: false } },
  orderBy: { createdAt: "desc" },
  select: { id: true, nroSolicitud: true, estadoActual: {
    select: { name: true, owner: { select: { code: true, name: true } } },
  } },
} satisfies Prisma.SolicitudFindManyArgs;

function toPendingAreaAssignment(row: Prisma.SolicitudGetPayload<typeof pendingAreaAssignments>): PendingAreaAssignment {
  return {
    id: row.id, nroSolicitud: row.nroSolicitud,
    areaName: row.estadoActual.owner.name, areaCode: row.estadoActual.owner.code, stateName: row.estadoActual.name,
  };
}

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
      select: { ...UserMapper.profileSelect(), assignedSolicitudes: pendingAreaAssignments },
      where: {
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return users.map(user => ({ ...UserMapper.toDomain(user), pendingAssignments: user.assignedSolicitudes.map(toPendingAreaAssignment) }));
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

  async assignWorkflowOwner(input: AssignWorkflowOwnerInput): Promise<AuthUser & { pendingAssignments?: PendingAreaAssignment[] }> {
    const requestedIds = "workflowOwnerIds" in input
      ? input.workflowOwnerIds
      : input.workflowOwnerId ? [input.workflowOwnerId] : [];
    const ownerIds = requestedIds.map(id => id.toLowerCase());

    return this.prisma.$transaction(async (tx) => {
      // Serialize replacements on the same account before reading its old set.
      await tx.$queryRaw`SELECT usr_id FROM users WHERE usr_id = ${input.userId}::uuid FOR UPDATE`;
      const current = await tx.user.findFirst({
        where: { id: input.userId, deletedAt: null },
        select: {
          state: true, workflowOwnerId: true,
          workflowOwner: { select: { id: true, code: true } },
          workflowOwnerMemberships: { select: {
            workflowOwner: { select: { id: true, code: true } },
          } },
        },
      });
      if (!current) throw new UserNotFoundError();

      if ("workflowOwnerId" in input && current.workflowOwnerMemberships.length > 1) {
        throw new AuthConflictError("Esta cuenta tiene varias áreas. Editalas desde el formulario de Áreas.");
      }

      const owners = await tx.workflowOwner.findMany({
        where: { isActive: true, id: { in: ownerIds } },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { id: true, code: true },
      });
      if (owners.length !== ownerIds.length) throw new WorkflowOwnerNotFoundOrInactiveError();
      if (owners.length > 1 && owners.some(owner => !cumulativeWorkflowCodes.has(owner.code))) {
        throw new InvalidRequestError("Solo se pueden combinar Análisis, Tesorería y Legajos Digitales.");
      }
      const previous = current.workflowOwnerMemberships.length
        ? current.workflowOwnerMemberships.map(membership => membership.workflowOwner)
        : current.workflowOwner ? [current.workflowOwner] : [];
      const removed = previous.filter(area => !ownerIds.includes(area.id));
      const addedRisk = owners.some(owner => owner.code === "RIESGO")
        && !previous.some(owner => owner.code === "RIESGO");
      const removedRisk = removed.some(area => area.code === "RIESGO");
      const representative = owners.find(owner => owner.id === current.workflowOwnerId) ?? owners[0];
      // Update memberships first so the compatibility column reflects the final set.
      await tx.userWorkflowOwner.deleteMany({
        where: { userId: input.userId, workflowOwnerId: { notIn: ownerIds } },
      });
      await tx.userWorkflowOwner.createMany({
        data: ownerIds.map(workflowOwnerId => ({ userId: input.userId, workflowOwnerId })),
        skipDuplicates: true,
      });
      await tx.user.update({
        where: { id: input.userId },
        data: {
          workflowOwnerId: representative?.id ?? null,
          ...(current.state !== USER_STATE.INACTIVE && {
            state: owners.length ? USER_STATE.ACTIVE : USER_STATE.PENDING_AREA_ASSIGNMENT,
          }),
          ...(addedRisk && { recibeAsignacionAutomatica: true }),
          ...(removedRisk && { recibeAsignacionAutomatica: false }),
        },
        select: { id: true },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: input.userId }, select: UserMapper.profileSelect(),
      });
      const profile = UserMapper.toDomain(user);
      if (!("workflowOwnerIds" in input)) return profile;

      const pending = removed.length ? await tx.solicitud.findMany({
        ...pendingAreaAssignments,
        where: {
          ...pendingAreaAssignments.where, assignedToUserId: input.userId,
          pendingReassignmentAreaId: { in: removed.map(area => area.id) },
        },
      }) : [];
      const pendingAssignments = pending.map(toPendingAreaAssignment);
      return { ...profile, pendingAssignments };
    });
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
