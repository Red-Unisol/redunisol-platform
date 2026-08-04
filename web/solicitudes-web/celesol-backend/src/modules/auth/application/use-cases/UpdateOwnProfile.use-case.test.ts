import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AuthConflictError,
  InvalidRequestError,
  UserNotFoundError,
} from "../../domain/auth-errors";
import type { AuthUser, PersistedAuthUser } from "../../domain/entities/User.entity";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { EmailVerificationRepository } from "../../domain/repositories/EmailVerificationRepository";
import type { AccountVerificationEmailSender } from "../../domain/services/AccountVerificationEmailSender";
import type { EmailVerificationCodeGenerator } from "../../domain/services/EmailVerificationCodeGenerator";
import type { VerificationCodeHasher } from "../../domain/services/VerificationCodeHasher";
import { UpdateOwnProfileUseCase } from "./UpdateOwnProfile.use-case";

type InMemoryUser = AuthUser & { deletedAt: Date | null };

class InMemoryAuthRepository implements AuthRepository {
  users: InMemoryUser[];

  constructor(users: InMemoryUser[]) {
    this.users = users;
  }

  async findById(userId: string) {
    const user = this.users.find(
      (candidate) => candidate.id === userId && candidate.deletedAt === null,
    );

    return user ? toAuthUser(user) : null;
  }

  async findByIdWithPasswordHash(_: string): Promise<PersistedAuthUser | null> {
    throw new Error("not used");
  }

  async countActiveSystemAdmins(): Promise<number> {
    throw new Error("not used");
  }

  async updateUser(input: {
    id: string;
    email?: string;
    emailVerified?: boolean;
    firstName?: string;
    lastName?: string;
  }) {
    const user = this.users.find((candidate) => candidate.id === input.id);

    if (!user) {
      throw new UserNotFoundError();
    }

    user.email = input.email ?? user.email;
    user.emailVerified = input.emailVerified ?? user.emailVerified;
    user.firstName = input.firstName ?? user.firstName;
    user.lastName = input.lastName ?? user.lastName;

    return toAuthUser(user);
  }

  async updatePasswordAndRevokeSessions(): Promise<void> {
    throw new Error("not used");
  }

  async listUsers(): Promise<AuthUser[]> {
    throw new Error("not used");
  }

  async listPendingAreaUsers(): Promise<AuthUser[]> {
    throw new Error("not used");
  }

  async listActiveWorkflowOwners(): Promise<
    Array<{
      code: string;
      id: string;
      name: string;
    }>
  > {
    throw new Error("not used");
  }

  async create(): Promise<AuthUser> {
    throw new Error("not used");
  }

  async assignWorkflowOwner(): Promise<AuthUser> {
    throw new Error("not used");
  }

  async deleteById() {
    throw new Error("not used");
  }

  async findActiveById(): Promise<AuthUser | null> {
    throw new Error("not used");
  }

  async findActiveByIdentifier(): Promise<PersistedAuthUser | null> {
    throw new Error("not used");
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    const user = this.users.find(
      (candidate) =>
        candidate.deletedAt === null &&
        candidate.email.toLowerCase() === email.toLowerCase(),
    );

    return user ? toAuthUser(user) : null;
  }

  async findByLegacyUser(): Promise<AuthUser | null> {
    throw new Error("not used");
  }

  async existsOtherUserWithLegacyUser(): Promise<boolean> {
    throw new Error("not used");
  }

  async findActiveWorkflowOwnerById(): Promise<{ id: string } | null> {
    throw new Error("not used");
  }
}

class FakeEmailVerificationRepository implements EmailVerificationRepository {
  createForUserCalls: Array<{ userId: string }> = [];
  shouldFailCreate = false;
  recentSendsCount = 0;

  async countCreatedSinceByUserId(): Promise<number> {
    return this.recentSendsCount;
  }

  async createForUser(input: { userId: string }): Promise<void> {
    if (this.shouldFailCreate) {
      throw new Error("db down");
    }

    this.createForUserCalls.push({ userId: input.userId });
  }

  async findValidByEmailAndHash(): Promise<never> {
    throw new Error("not used");
  }

  async markUsedAndVerifyUser(): Promise<AuthUser> {
    throw new Error("not used");
  }
}

class FakeAccountVerificationEmailSender implements AccountVerificationEmailSender {
  sentTo: string[] = [];
  shouldFailSend = false;

  async sendAccountVerificationEmail(input: { to: string }): Promise<void> {
    if (this.shouldFailSend) {
      throw new Error("smtp down");
    }

    this.sentTo.push(input.to);
  }
}

const fakeCodeGenerator: EmailVerificationCodeGenerator = {
  generate: () => "123456",
};

const fakeCodeHasher: VerificationCodeHasher = {
  hash: (code: string) => `hashed-${code}`,
};

function toAuthUser(user: InMemoryUser): AuthUser {
  return {
    email: user.email,
    emailVerified: user.emailVerified,
    firstName: user.firstName,
    id: user.id,
    isSystemAdmin: user.isSystemAdmin,
    lastName: user.lastName,
    legacyUser: user.legacyUser,
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
    state: 1,
    workflowOwnerId: "owner-1",
    ...overrides,
  };
}

function buildUseCase(overrides: {
  emailVerificationRepository?: FakeEmailVerificationRepository;
  emailSender?: FakeAccountVerificationEmailSender;
  users: InMemoryUser[];
}) {
  const emailVerificationRepository =
    overrides.emailVerificationRepository ?? new FakeEmailVerificationRepository();
  const accountVerificationEmailSender =
    overrides.emailSender ?? new FakeAccountVerificationEmailSender();

  return {
    accountVerificationEmailSender,
    emailVerificationRepository,
    useCase: new UpdateOwnProfileUseCase({
      accountVerificationEmailSender,
      config: {
        accessTokenTtlMinutes: 30,
        emailSendRateLimitMax: 5,
        emailSendRateLimitWindowMinutes: 60,
        emailVerificationCodeTtlMinutes: 15,
        refreshTokenTtlDays: 7,
      },
      emailVerificationCodeGenerator: fakeCodeGenerator,
      emailVerificationRepository,
      userRepository: new InMemoryAuthRepository(overrides.users),
      verificationCodeHasher: fakeCodeHasher,
    }),
  };
}

describe("UpdateOwnProfileUseCase", () => {
  it("updates firstName and lastName without touching email", async () => {
    const { useCase } = buildUseCase({
      users: [createUser({ firstName: "Old", lastName: "Old" })],
    });

    const user = await useCase.execute({
      firstName: "  New  ",
      lastName: "  Name  ",
      userId: "11111111-1111-1111-1111-111111111111",
    });

    assert.equal(user.firstName, "New");
    assert.equal(user.lastName, "Name");
    assert.equal(user.email, "user@example.com");
    assert.equal(user.emailVerified, true);
  });

  it("rejects empty firstName after trim", async () => {
    const { useCase } = buildUseCase({ users: [createUser({})] });

    await assert.rejects(
      () =>
        useCase.execute({
          firstName: "   ",
          userId: "11111111-1111-1111-1111-111111111111",
        }),
      InvalidRequestError,
    );
  });

  it("rejects empty lastName after trim", async () => {
    const { useCase } = buildUseCase({ users: [createUser({})] });

    await assert.rejects(
      () =>
        useCase.execute({
          lastName: "   ",
          userId: "11111111-1111-1111-1111-111111111111",
        }),
      InvalidRequestError,
    );
  });

  it("rejects empty email after trim", async () => {
    const { useCase } = buildUseCase({ users: [createUser({})] });

    await assert.rejects(
      () =>
        useCase.execute({
          email: "   ",
          userId: "11111111-1111-1111-1111-111111111111",
        }),
      InvalidRequestError,
    );
  });

  it("throws UserNotFoundError when the user does not exist", async () => {
    const { useCase } = buildUseCase({ users: [] });

    await assert.rejects(
      () =>
        useCase.execute({
          firstName: "New",
          userId: "does-not-exist",
        }),
      UserNotFoundError,
    );
  });

  it("changing the email marks emailVerified false and sends a new code", async () => {
    const { accountVerificationEmailSender, emailVerificationRepository, useCase } =
      buildUseCase({
        users: [createUser({ email: "old@example.com" })],
      });

    const user = await useCase.execute({
      email: "  NEW@Example.com  ",
      userId: "11111111-1111-1111-1111-111111111111",
    });

    assert.equal(user.email, "new@example.com");
    assert.equal(user.emailVerified, false);
    assert.equal(emailVerificationRepository.createForUserCalls.length, 1);
    assert.equal(accountVerificationEmailSender.sentTo[0], "new@example.com");
  });

  it("keeping the same email does not reset emailVerified or send a code", async () => {
    const { emailVerificationRepository, useCase } = buildUseCase({
      users: [createUser({ email: "same@example.com", emailVerified: true })],
    });

    const user = await useCase.execute({
      email: "  Same@Example.com  ",
      userId: "11111111-1111-1111-1111-111111111111",
    });

    assert.equal(user.emailVerified, true);
    assert.equal(emailVerificationRepository.createForUserCalls.length, 0);
  });

  it("throws AuthConflictError when the new email belongs to another user", async () => {
    const { useCase } = buildUseCase({
      users: [
        createUser({ id: "user-1", email: "user1@example.com" }),
        createUser({ id: "user-2", email: "user2@example.com" }),
      ],
    });

    await assert.rejects(
      () =>
        useCase.execute({
          email: "user2@example.com",
          userId: "user-1",
        }),
      AuthConflictError,
    );
  });

  it("does not fail the update when the verification email send fails", async () => {
    const emailSender = new FakeAccountVerificationEmailSender();
    emailSender.shouldFailSend = true;
    const { useCase } = buildUseCase({
      emailSender,
      users: [createUser({ email: "old@example.com" })],
    });

    const user = await useCase.execute({
      email: "new@example.com",
      userId: "11111111-1111-1111-1111-111111111111",
    });

    assert.equal(user.email, "new@example.com");
    assert.equal(user.emailVerified, false);
  });

  it("changing the email still succeeds but skips sending when the rate limit was already hit", async () => {
    const emailVerificationRepository = new FakeEmailVerificationRepository();
    emailVerificationRepository.recentSendsCount = 5;
    const { accountVerificationEmailSender, useCase } = buildUseCase({
      emailVerificationRepository,
      users: [createUser({ email: "old@example.com" })],
    });

    const user = await useCase.execute({
      email: "new@example.com",
      userId: "11111111-1111-1111-1111-111111111111",
    });

    assert.equal(user.email, "new@example.com");
    assert.equal(user.emailVerified, false);
    assert.equal(emailVerificationRepository.createForUserCalls.length, 0);
    assert.equal(accountVerificationEmailSender.sentTo.length, 0);
  });
});
