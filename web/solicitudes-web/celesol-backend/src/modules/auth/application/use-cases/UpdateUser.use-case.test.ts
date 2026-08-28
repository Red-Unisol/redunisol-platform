import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AuthConflictError,
  InvalidRequestError,
  LastActiveSystemAdminDeactivationError,
  LastActiveSystemAdminDemotionError,
  SelfDeactivationError,
  SelfSystemAdminDemotionError,
  UserNotFoundError,
} from "../../domain/auth-errors";
import type { AuthUser, PersistedAuthUser } from "../../domain/entities/User.entity";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import { USER_STATE } from "../../domain/user-state";
import { UpdateUserUseCase } from "./UpdateUser.use-case";

type InMemoryUser = AuthUser & {
  deletedAt: Date | null;
};

class InMemoryAuthRepository implements AuthRepository {
  users: InMemoryUser[] = [];

  constructor(users: InMemoryUser[]) {
    this.users = users;
  }

  async findById(userId: string) {
    const user = this.users.find(
      (candidate) => candidate.id === userId && candidate.deletedAt === null,
    );

    return user ? toAuthUser(user) : null;
  }

  async countActiveSystemAdmins() {
    return this.users.filter(
      (user) =>
        user.deletedAt === null &&
        user.isSystemAdmin &&
        user.state === USER_STATE.ACTIVE,
    ).length;
  }

  async updateUser(input: {
    id: string;
    email?: string;
    firstName?: string;
    isSystemAdmin?: boolean;
    lastName?: string;
    legacyUser?: string;
    state?: number;
  }) {
    const user = this.users.find(
      (candidate) => candidate.id === input.id && candidate.deletedAt === null,
    );

    if (!user) {
      throw new UserNotFoundError();
    }

    if (input.email !== undefined) {
      const duplicate = this.users.find(
        (candidate) =>
          candidate.id !== user.id &&
          candidate.deletedAt === null &&
          candidate.email.toLowerCase() === input.email!.toLowerCase(),
      );

      if (duplicate) {
        throw new AuthConflictError("Email already registered.");
      }
    }

    if (input.legacyUser !== undefined) {
      const duplicate = this.users.find(
        (candidate) =>
          candidate.id !== user.id &&
          candidate.deletedAt === null &&
          candidate.legacyUser.toLowerCase() === input.legacyUser!.toLowerCase(),
      );

      if (duplicate) {
        throw new AuthConflictError("Legacy user already registered.");
      }
    }

    user.email = input.email ?? user.email;
    user.firstName = input.firstName ?? user.firstName;
    user.isSystemAdmin = input.isSystemAdmin ?? user.isSystemAdmin;
    user.lastName = input.lastName ?? user.lastName;
    user.legacyUser = input.legacyUser ?? user.legacyUser;
    user.state = input.state ?? user.state;

    return toAuthUser(user);
  }

  async listUsers() {
    return this.users.filter((user) => user.deletedAt === null).map(toAuthUser);
  }

  async listPendingAreaUsers() {
    return [];
  }

  async listActiveWorkflowOwners() {
    return [];
  }

  async create(_: {
    email: string;
    firstName: string;
    lastName: string;
    legacyUser: string;
    passwordHash: string;
    state?: number;
    workflowOwnerId?: string | null;
  }): Promise<AuthUser> {
    throw new Error("not used");
  }

  async assignWorkflowOwner(_: {
    userId: string;
    workflowOwnerId: string | null;
  }): Promise<AuthUser> {
    throw new Error("not used");
  }

  async deleteById() {
    throw new Error("not used");
  }

  async findActiveById(_: string): Promise<AuthUser | null> {
    throw new Error("not used");
  }

  async findActiveByIdentifier(_: string): Promise<PersistedAuthUser | null> {
    throw new Error("not used");
  }

  async findByEmail(_: string): Promise<AuthUser | null> {
    throw new Error("not used");
  }

  async findByLegacyUser(_: string): Promise<AuthUser | null> {
    throw new Error("not used");
  }

  async existsOtherUserWithLegacyUser(input: {
    excludeUserId: string;
    legacyUser: string;
  }) {
    return this.users.some(
      (candidate) =>
        candidate.deletedAt === null &&
        candidate.id !== input.excludeUserId &&
        candidate.legacyUser.toLowerCase() === input.legacyUser.toLowerCase(),
    );
  }

  async findActiveWorkflowOwnerById(_: string): Promise<{ id: string } | null> {
    throw new Error("not used");
  }

  async findByIdWithPasswordHash(_: string): Promise<PersistedAuthUser | null> {
    throw new Error("not used");
  }

  async updatePasswordAndRevokeSessions(_: {
    userId: string;
    passwordHash: string;
  }): Promise<void> {
    throw new Error("not used");
  }
}

function toAuthUser(user: InMemoryUser): AuthUser {
  return {
    email: user.email,
    emailVerified: user.emailVerified,
    firstName: user.firstName,
    id: user.id,
    isSystemAdmin: user.isSystemAdmin,
    lastName: user.lastName,
    legacyUser: user.legacyUser,
    recibeAsignacionAutomatica: user.recibeAsignacionAutomatica,
    state: user.state,
    workflowOwnerId: user.workflowOwnerId,
  };
}

function createUser(overrides: Partial<InMemoryUser>): InMemoryUser {
  return {
    deletedAt: null,
    email: "user@example.com",
    emailVerified: true,
    firstName: "User",
    id: "11111111-1111-1111-1111-111111111111",
    isSystemAdmin: false,
    lastName: "User",
    legacyUser: "UUSER",
    recibeAsignacionAutomatica: false,
    state: USER_STATE.ACTIVE,
    workflowOwnerId: "owner-1",
    ...overrides,
  };
}

describe("UpdateUserUseCase", () => {
  it("updates email for a target user and normalizes it", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", isSystemAdmin: false, email: "old@example.com" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    const user = await useCase.execute({
      authenticatedUserId: "admin-1",
      email: "  NEW@Example.com  ",
      userId: "user-1",
    });

    assert.equal(user.email, "new@example.com");
  });

  it("updates isSystemAdmin for another user", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", isSystemAdmin: false }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    const user = await useCase.execute({
      authenticatedUserId: "admin-1",
      isSystemAdmin: true,
      userId: "user-1",
    });

    assert.equal(user.isSystemAdmin, true);
  });

  it("updates state to inactive for another user", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", state: USER_STATE.ACTIVE }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    const user = await useCase.execute({
      authenticatedUserId: "admin-1",
      state: USER_STATE.INACTIVE,
      userId: "user-1",
    });

    assert.equal(user.state, USER_STATE.INACTIVE);
  });

  it("updates state to active for another user", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", state: USER_STATE.INACTIVE }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    const user = await useCase.execute({
      authenticatedUserId: "admin-1",
      state: USER_STATE.ACTIVE,
      userId: "user-1",
    });

    assert.equal(user.state, USER_STATE.ACTIVE);
  });

  it("updates firstName only", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ firstName: "Old", id: "user-1" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    const user = await useCase.execute({
      authenticatedUserId: "admin-1",
      firstName: "  New  ",
      userId: "user-1",
    });

    assert.equal(user.firstName, "New");
  });

  it("updates lastName only", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", lastName: "Old" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    const user = await useCase.execute({
      authenticatedUserId: "admin-1",
      lastName: "  New  ",
      userId: "user-1",
    });

    assert.equal(user.lastName, "New");
  });

  it("updates firstName and lastName together", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ firstName: "Old", id: "user-1", lastName: "Old" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    const user = await useCase.execute({
      authenticatedUserId: "admin-1",
      firstName: "  Jane  ",
      lastName: "  Doe  ",
      userId: "user-1",
    });

    assert.equal(user.firstName, "Jane");
    assert.equal(user.lastName, "Doe");
  });

  it("rejects firstName empty after trim", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-1",
          firstName: "   ",
          userId: "user-1",
        }),
      InvalidRequestError,
    );
  });

  it("rejects lastName empty after trim", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-1",
          lastName: "   ",
          userId: "user-1",
        }),
      InvalidRequestError,
    );
  });

  it("updates legacyUser and normalizes with trim+lowercase", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", legacyUser: "Legacy.Old" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    const user = await useCase.execute({
      authenticatedUserId: "admin-1",
      legacyUser: "  New.User  ",
      userId: "user-1",
    });

    assert.equal(user.legacyUser, "new.user");
  });

  it("rejects legacyUser empty after trim", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", legacyUser: "legacy.user" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-1",
          legacyUser: "   ",
          userId: "user-1",
        }),
      InvalidRequestError,
    );
  });

  it("throws 409 when legacyUser already exists after normalization", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", legacyUser: "taken.user" }),
      createUser({ id: "user-2", legacyUser: "other.user" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-1",
          legacyUser: "  Taken.User  ",
          userId: "user-2",
        }),
      AuthConflictError,
    );
  });

  it("throws 409 when another user has same legacyUser with mixed casing", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", legacyUser: "Legacy.User" }),
      createUser({ id: "user-2", legacyUser: "other.user" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-1",
          legacyUser: "legacy.user",
          userId: "user-2",
        }),
      AuthConflictError,
    );
  });

  it("throws 409 when another user has same legacyUser with spaces and uppercase", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", legacyUser: "Legacy.User" }),
      createUser({ id: "user-2", legacyUser: "other.user" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-1",
          legacyUser: "  LEGACY.USER  ",
          userId: "user-2",
        }),
      AuthConflictError,
    );
  });

  it("allows updating same user with its own legacyUser in different casing", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", legacyUser: "Legacy.User" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    const updated = await useCase.execute({
      authenticatedUserId: "admin-1",
      legacyUser: "  LEGACY.USER  ",
      userId: "user-1",
    });

    assert.equal(updated.legacyUser, "legacy.user");
  });

  it("throws 404 when target user does not exist or is soft-deleted", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({
        deletedAt: new Date(),
        id: "deleted-user",
      }),
      createUser({ id: "admin-1", isSystemAdmin: true }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-1",
          state: USER_STATE.INACTIVE,
          userId: "deleted-user",
        }),
      UserNotFoundError,
    );
  });

  it("throws 409 when email already exists after normalization", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ email: "taken@example.com", id: "user-1" }),
      createUser({ email: "other@example.com", id: "user-2" }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-1",
          email: "  Taken@Example.com ",
          userId: "user-2",
        }),
      AuthConflictError,
    );
  });

  it("throws 409 on self-demotion", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "admin-2", isSystemAdmin: true }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-1",
          isSystemAdmin: false,
          userId: "admin-1",
        }),
      SelfSystemAdminDemotionError,
    );
  });

  it("throws 409 on self-deactivation", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "admin-2", isSystemAdmin: true }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-1",
          state: USER_STATE.INACTIVE,
          userId: "admin-1",
        }),
      SelfDeactivationError,
    );
  });

  it("throws 409 when removing admin flag from last active system admin", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", isSystemAdmin: false }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-2",
          isSystemAdmin: false,
          userId: "admin-1",
        }),
      LastActiveSystemAdminDemotionError,
    );
  });

  it("throws 409 when deactivating last active system admin", async () => {
    const repo = new InMemoryAuthRepository([
      createUser({ id: "admin-1", isSystemAdmin: true }),
      createUser({ id: "user-1", isSystemAdmin: false }),
    ]);
    const useCase = new UpdateUserUseCase({ userRepository: repo });

    await assert.rejects(
      () =>
        useCase.execute({
          authenticatedUserId: "admin-2",
          state: USER_STATE.INACTIVE,
          userId: "admin-1",
        }),
      LastActiveSystemAdminDeactivationError,
    );
  });
});
