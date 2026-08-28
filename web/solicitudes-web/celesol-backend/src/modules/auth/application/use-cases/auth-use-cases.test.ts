import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AuthConflictError,
  EmailNotVerifiedError,
  InvalidCredentialsError,
  InvalidEmailVerificationCodeError,
  InvalidSessionError,
  LegacyServiceUnavailableError,
  LegacyUserInactiveError,
  LegacyUserNotFoundError,
  TooManyEmailRequestsError,
} from "../../domain/auth-errors";
import type {
  AuthUser,
  PersistedAuthUser,
} from "../../domain/entities/User.entity";
import type {
  RefreshTokenRecord,
  RequestMetadata,
} from "../../domain/entities/RefreshToken.entity";
import type { EmailVerificationTokenRecord } from "../../domain/entities/EmailVerificationToken.entity";
import type { AuthRepository } from "../../domain/repositories/AuthRepository";
import type { EmailVerificationRepository } from "../../domain/repositories/EmailVerificationRepository";
import type { RefreshTokenRepository } from "../../domain/repositories/RefreshTokenRepository";
import type { AccountVerificationEmailSender } from "../../domain/services/AccountVerificationEmailSender";
import type {
  AccessTokenPayload,
  AccessTokenService,
} from "../../domain/services/AccessTokenService";
import type {
  LegacyUserVerification,
  LegacyUserVerifier,
} from "../../domain/services/LegacyUserVerifier";
import type { EmailVerificationCodeGenerator } from "../../domain/services/EmailVerificationCodeGenerator";
import type { PasswordHasher } from "../../domain/services/PasswordHasher";
import type { RefreshTokenService } from "../../domain/services/RefreshTokenService";
import type { VerificationCodeHasher } from "../../domain/services/VerificationCodeHasher";
import { USER_STATE } from "../../domain/user-state";
import { GetCurrentUserUseCase } from "./GetCurrentUser.use-case";
import { LoginUserUseCase } from "./LoginUser.use-case";
import { LogoutUserUseCase } from "./LogoutUser.use-case";
import { RegisterUserUseCase } from "./RegisterUser.use-case";
import { ResendVerificationCodeUseCase } from "./ResendVerificationCode.use-case";
import { RefreshSessionUseCase } from "./RefreshSession.use-case";
import { VerifyEmailUseCase } from "./VerifyEmail.use-case";

const activeUser: PersistedAuthUser = {
  email: "user@example.com",
  emailVerified: true,
  firstName: "Test",
  id: "11111111-1111-1111-1111-111111111111",
  isSystemAdmin: false,
  lastName: "User",
  legacyUser: "legacy.user",
  recibeAsignacionAutomatica: false,
  passwordHash: "hashed-password",
  state: USER_STATE.ACTIVE,
  workflowOwnerId: "owner-1",
  workflowOwner: {
    code: "VENDEDORES",
    id: "owner-1",
    name: "Vendedores",
  },
};

function toAuthUserView(
  user: Pick<
    PersistedAuthUser,
    | "email"
    | "emailVerified"
    | "firstName"
    | "id"
    | "isSystemAdmin"
    | "lastName"
    | "legacyUser"
    | "recibeAsignacionAutomatica"
    | "state"
    | "workflowOwnerId"
    | "workflowOwner"
  >,
): AuthUser {
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
    workflowOwner: user.workflowOwner ?? null,
  };
}

class FakeUserRepository implements AuthRepository {
  users: PersistedAuthUser[] = [activeUser];
  usersById: Map<string, AuthUser> | null = null;

  async listUsers(): Promise<AuthUser[]> {
    return this.users.map((user) => toAuthUserView(user));
  }

  async findById(userId: string): Promise<AuthUser | null> {
    const user = this.users.find((candidate) => candidate.id === userId);

    return user ? toAuthUserView(user) : null;
  }

  async countActiveSystemAdmins(): Promise<number> {
    return this.users.filter(
      (user) => user.isSystemAdmin && user.state === USER_STATE.ACTIVE,
    ).length;
  }

  async updateUser(): Promise<AuthUser> {
    throw new Error("not used");
  }

  async existsOtherUserWithLegacyUser(input: {
    excludeUserId: string;
    legacyUser: string;
  }): Promise<boolean> {
    return this.users.some(
      (user) =>
        user.id !== input.excludeUserId &&
        user.legacyUser.toLowerCase() === input.legacyUser.toLowerCase(),
    );
  }

  async listPendingAreaUsers(): Promise<AuthUser[]> {
    return this.users
      .filter(
        (user) =>
          user.state === USER_STATE.PENDING_AREA_ASSIGNMENT &&
          user.workflowOwnerId === null,
      )
      .map((user) => toAuthUserView(user));
  }

  async listActiveWorkflowOwners() {
    return [{ code: "VENDEDORES", id: "owner-1", name: "Vendedores" }];
  }

  async assignWorkflowOwner(input: {
    userId: string;
    workflowOwnerId: string;
  }): Promise<AuthUser> {
    const user = this.users.find((candidate) => candidate.id === input.userId);

    if (!user) {
      throw new Error("User not found");
    }

    user.workflowOwnerId = input.workflowOwnerId;
    user.state = USER_STATE.ACTIVE;
    user.workflowOwner =
      input.workflowOwnerId === "owner-1"
        ? { code: "VENDEDORES", id: "owner-1", name: "Vendedores" }
        : { code: "RIESGO", id: input.workflowOwnerId, name: "Área Riesgo" };

    return toAuthUserView(user);
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
    const user: PersistedAuthUser = {
      email: input.email,
      emailVerified: false,
      firstName: input.firstName,
      id: "22222222-2222-2222-2222-222222222222",
      isSystemAdmin: false,
      lastName: input.lastName,
      legacyUser: input.legacyUser,
      recibeAsignacionAutomatica: false,
      passwordHash: input.passwordHash,
      state: input.state ?? USER_STATE.PENDING_AREA_ASSIGNMENT,
      workflowOwnerId:
        input.workflowOwnerId === undefined ? null : input.workflowOwnerId,
      workflowOwner: null,
    };
    this.users.push(user);
    this.usersById?.set(user.id, toAuthUserView(user));

    return toAuthUserView(user);
  }

  async deleteById(userId: string): Promise<void> {
    this.users = this.users.filter((user) => user.id !== userId);
    this.usersById?.delete(userId);
  }

  async findActiveById(userId: string): Promise<AuthUser | null> {
    const user = this.users.find((candidate) => candidate.id === userId);

    if (!user) {
      return null;
    }

    if (
      user.state !== USER_STATE.ACTIVE &&
      user.state !== USER_STATE.PENDING_AREA_ASSIGNMENT
    ) {
      return null;
    }

    return toAuthUserView(user);
  }

  async findActiveByIdentifier(
    identifier: string,
  ): Promise<PersistedAuthUser | null> {
    const normalizedIdentifier = identifier.toLowerCase();

    return (
      this.users.find(
        (candidate) =>
          (candidate.state === USER_STATE.ACTIVE ||
            candidate.state === USER_STATE.PENDING_AREA_ASSIGNMENT) &&
          (candidate.email.toLowerCase() === normalizedIdentifier ||
            candidate.legacyUser.toLowerCase() === normalizedIdentifier),
      ) ?? null
    );
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    const normalizedEmail = email.toLowerCase();
    const user = this.users.find(
      (candidate) => candidate.email.toLowerCase() === normalizedEmail,
    );

    return user ? toAuthUserView(user) : null;
  }

  async findByLegacyUser(legacyUser: string): Promise<AuthUser | null> {
    const normalizedLegacyUser = legacyUser.toLowerCase();
    const user = this.users.find(
      (candidate) =>
        candidate.legacyUser.toLowerCase() === normalizedLegacyUser,
    );

    return user ? toAuthUserView(user) : null;
  }

  async findActiveWorkflowOwnerById(workflowOwnerId: string) {
    if (workflowOwnerId === "inactive-owner") {
      return null;
    }
    return { id: workflowOwnerId };
  }

  async findByIdWithPasswordHash(
    userId: string,
  ): Promise<PersistedAuthUser | null> {
    const user = this.users.find((candidate) => candidate.id === userId);

    return user ?? null;
  }

  async updatePasswordAndRevokeSessions(_: {
    userId: string;
    passwordHash: string;
  }): Promise<void> {
    throw new Error("not used");
  }
}

class FakeEmailVerificationRepository implements EmailVerificationRepository {
  failure: Error | null = null;
  tokens: EmailVerificationTokenRecord[] = [];
  usersById: Map<string, AuthUser>;

  constructor(usersById: Map<string, AuthUser>) {
    this.usersById = usersById;
  }

  async countCreatedSinceByUserId(input: { since: Date; userId: string }) {
    void input.since;
    return this.tokens.filter((token) => token.userId === input.userId).length;
  }

  async createForUser(input: {
    expiresAt: Date;
    tokenHash: string;
    userId: string;
  }) {
    if (this.failure) {
      throw this.failure;
    }

    const user = this.usersById.get(input.userId);

    if (!user) {
      throw new Error("User not found");
    }

    this.tokens.push({
      expiresAt: input.expiresAt,
      id: `token-${this.tokens.length + 1}`,
      tokenHash: input.tokenHash,
      usedAt: null,
      user,
      userId: input.userId,
    });
  }

  async findValidByEmailAndHash(input: {
    email: string;
    now: Date;
    tokenHash: string;
  }) {
    return (
      this.tokens.find(
        (token) =>
          token.tokenHash === input.tokenHash &&
          token.usedAt === null &&
          token.expiresAt > input.now &&
          token.user.email.toLowerCase() === input.email.toLowerCase(),
      ) ?? null
    );
  }

  async markUsedAndVerifyUser(input: {
    tokenId: string;
    usedAt: Date;
    userId: string;
  }) {
    const token = this.tokens.find(
      (candidate) => candidate.id === input.tokenId,
    );
    const user = this.usersById.get(input.userId);

    if (!token || !user) {
      throw new Error("Token not found");
    }

    token.usedAt = input.usedAt;
    const verifiedUser = {
      ...user,
      emailVerified: true,
    };
    this.usersById.set(user.id, verifiedUser);
    token.user = verifiedUser;

    return verifiedUser;
  }
}

class FakeRefreshTokenRepository implements RefreshTokenRepository {
  tokens = new Map<string, RefreshTokenRecord>();
  revokedTokenHashes: string[] = [];

  async create(input: {
    expiresAt: Date;
    metadata: RequestMetadata;
    tokenHash: string;
    userId: string;
  }) {
    this.tokens.set(input.tokenHash, {
      expiresAt: input.expiresAt,
      id: input.tokenHash,
      revokedAt: null,
      tokenHash: input.tokenHash,
      user: toAuthUserView(activeUser),
      userId: input.userId,
    });
  }

  async findByHash(tokenHash: string) {
    return this.tokens.get(tokenHash) ?? null;
  }

  async revoke(tokenHash: string, replacedByTokenHash?: string) {
    const token = this.tokens.get(tokenHash);
    this.revokedTokenHashes.push(tokenHash);

    if (token) {
      token.revokedAt = new Date();
      token.tokenHash = replacedByTokenHash ?? token.tokenHash;
    }
  }

  async rotate(input: {
    currentTokenHash: string;
    expiresAt: Date;
    metadata: RequestMetadata;
    newTokenHash: string;
    userId: string;
  }) {
    if (!this.tokens.has(input.currentTokenHash)) {
      return false;
    }

    await this.revoke(input.currentTokenHash, input.newTokenHash);
    await this.create({
      expiresAt: input.expiresAt,
      metadata: input.metadata,
      tokenHash: input.newTokenHash,
      userId: input.userId,
    });

    return true;
  }
}

class FakePasswordHasher implements PasswordHasher {
  hashedPasswords: string[] = [];
  shouldMatch = true;

  async compare() {
    return this.shouldMatch;
  }

  async hash(password: string) {
    const passwordHash = `hashed:${password}`;
    this.hashedPasswords.push(passwordHash);
    return passwordHash;
  }
}

class FakeAccountVerificationEmailSender
  implements AccountVerificationEmailSender
{
  failure: Error | null = null;
  sentEmails: Array<{ code: string; to: string }> = [];

  async sendAccountVerificationEmail(input: { code: string; to: string }) {
    if (this.failure) {
      throw this.failure;
    }

    this.sentEmails.push(input);
  }
}

class FakeEmailVerificationCodeGenerator
  implements EmailVerificationCodeGenerator
{
  code = "123456";

  generate() {
    return this.code;
  }
}

class FakeVerificationCodeHasher implements VerificationCodeHasher {
  hash(code: string) {
    return `hash:${code}`;
  }
}

class FakeLegacyUserVerifier implements LegacyUserVerifier {
  failure: Error | null = null;
  users = new Map<string, LegacyUserVerification>([
    [
      "new.user",
      {
        active: true,
        id: 10,
        userName: "new.user",
      },
    ],
  ]);

  async verifyByUserName(userName: string) {
    if (this.failure) {
      throw this.failure;
    }

    return this.users.get(userName.toLowerCase()) ?? null;
  }
}

class FakeAccessTokenService implements AccessTokenService {
  private readonly tokenUserIds = new Map<string, string>();

  sign(payload: AccessTokenPayload) {
    const token = `access-token:${payload.userId}`;
    this.tokenUserIds.set(token, payload.userId);
    return token;
  }

  verify(token: string) {
    const userId = this.tokenUserIds.get(token);

    if (!userId) {
      throw new InvalidSessionError();
    }

    return { userId };
  }
}

class FakeRefreshTokenService implements RefreshTokenService {
  private nextToken = 1;

  generate() {
    const token = `refresh-token-${this.nextToken}`;
    this.nextToken += 1;
    return token;
  }

  hash(token: string) {
    return `hash:${token}`;
  }
}

function createService() {
  const accessTokenService = new FakeAccessTokenService();
  const legacyUserVerifier = new FakeLegacyUserVerifier();
  const passwordHasher = new FakePasswordHasher();
  const refreshTokenRepository = new FakeRefreshTokenRepository();
  const refreshTokenService = new FakeRefreshTokenService();
  const userRepository = new FakeUserRepository();
  const usersById = new Map<string, AuthUser>(
    userRepository.users.map((user) => [
      user.id,
      toAuthUserView(user),
    ]),
  );
  userRepository.usersById = usersById;
  const emailVerificationRepository = new FakeEmailVerificationRepository(
    usersById,
  );
  const accountVerificationEmailSender =
    new FakeAccountVerificationEmailSender();
  const emailVerificationCodeGenerator =
    new FakeEmailVerificationCodeGenerator();
  const verificationCodeHasher = new FakeVerificationCodeHasher();
  const config = {
    accessTokenTtlMinutes: 15,
    emailVerificationCodeTtlMinutes: 15,
    emailSendRateLimitMax: 5,
    emailSendRateLimitWindowMinutes: 15,
    refreshTokenTtlDays: 7,
  };

  return {
    accessTokenService,
    accountVerificationEmailSender,
    emailVerificationCodeGenerator,
    emailVerificationRepository,
    getCurrentUserUseCase: new GetCurrentUserUseCase({
      accessTokenService,
      userRepository,
    }),
    loginUserUseCase: new LoginUserUseCase({
      accessTokenService,
      config,
      passwordHasher,
      refreshTokenRepository,
      refreshTokenService,
      userRepository,
    }),
    logoutUserUseCase: new LogoutUserUseCase({
      refreshTokenRepository,
      refreshTokenService,
    }),
    legacyUserVerifier,
    passwordHasher,
    registerUserUseCase: new RegisterUserUseCase({
      accountVerificationEmailSender,
      config,
      emailVerificationCodeGenerator,
      emailVerificationRepository,
      legacyUserVerifier,
      passwordHasher,
      userRepository,
      verificationCodeHasher,
    }),
    resendVerificationCodeUseCase: new ResendVerificationCodeUseCase({
      accountVerificationEmailSender,
      config,
      emailVerificationCodeGenerator,
      emailVerificationRepository,
      userRepository,
      verificationCodeHasher,
    }),
    refreshSessionUseCase: new RefreshSessionUseCase({
      accessTokenService,
      config,
      refreshTokenRepository,
      refreshTokenService,
      userRepository,
    }),
    refreshTokenRepository,
    refreshTokenService,
    userRepository,
    usersById,
    verificationCodeHasher,
    verifyEmailUseCase: new VerifyEmailUseCase({
      emailVerificationRepository,
      userRepository,
      verificationCodeHasher,
    }),
  };
}

describe("auth use cases", () => {
  it("registers a valid user without exposing password hash", async () => {
    const {
      accountVerificationEmailSender,
      emailVerificationRepository,
      passwordHasher,
      registerUserUseCase,
      userRepository,
    } = createService();
    const result = await registerUserUseCase.execute({
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
      legacyUser: "new.user",
      password: "Password1!",
    });
    const { user } = result;

    assert.equal(result.verificationEmailSent, true);
    assert.deepEqual(user, {
      email: "new@example.com",
      emailVerified: false,
      firstName: "New",
      id: "22222222-2222-2222-2222-222222222222",
      isSystemAdmin: false,
      lastName: "User",
      legacyUser: "new.user",
      recibeAsignacionAutomatica: false,
      state: USER_STATE.PENDING_AREA_ASSIGNMENT,
      workflowOwnerId: null,
      workflowOwner: null,
    });
    assert.equal("passwordHash" in user, false);
    assert.deepEqual(passwordHasher.hashedPasswords, ["hashed:Password1!"]);
    assert.equal(
      userRepository.users.at(-1)?.passwordHash,
      "hashed:Password1!",
    );
    assert.equal(
      emailVerificationRepository.tokens.at(-1)?.tokenHash,
      "hash:123456",
    );
    assert.deepEqual(accountVerificationEmailSender.sentEmails, [
      {
        code: "123456",
        to: "new@example.com",
      },
    ]);
  });

  it("keeps registered user when verification email delivery fails", async () => {
    const {
      accountVerificationEmailSender,
      registerUserUseCase,
      userRepository,
    } = createService();
    accountVerificationEmailSender.failure = new Error("smtp failed");

    const result = await registerUserUseCase.execute({
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
      legacyUser: "new.user",
      password: "Password1!",
    });

    assert.equal(result.verificationEmailSent, false);
    assert.equal(userRepository.users.length, 2);
    assert.equal(userRepository.users.at(-1)?.email, "new@example.com");
    assert.equal(userRepository.users.at(-1)?.emailVerified, false);
  });

  it("keeps registered user when verification token creation fails", async () => {
    const {
      emailVerificationRepository,
      registerUserUseCase,
      userRepository,
    } = createService();
    emailVerificationRepository.failure = new Error("db failed");

    const result = await registerUserUseCase.execute({
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
      legacyUser: "new.user",
      password: "Password1!",
    });

    assert.equal(result.verificationEmailSent, false);
    assert.equal(userRepository.users.length, 2);
    assert.equal(userRepository.users.at(-1)?.email, "new@example.com");
    assert.equal(userRepository.users.at(-1)?.emailVerified, false);
    assert.equal(emailVerificationRepository.tokens.length, 0);
  });

  it("rejects duplicate register email with conflict", async () => {
    const { registerUserUseCase } = createService();

    await assert.rejects(
      () =>
        registerUserUseCase.execute({
          email: activeUser.email,
          firstName: "New",
          lastName: "User",
          legacyUser: "available.user",
          password: "Password1!",
        }),
      AuthConflictError,
    );
  });

  it("rejects duplicate register legacy user with conflict", async () => {
    const { registerUserUseCase } = createService();

    await assert.rejects(
      () =>
        registerUserUseCase.execute({
          email: "available@example.com",
          firstName: "New",
          lastName: "User",
          legacyUser: activeUser.legacyUser,
          password: "Password1!",
        }),
      AuthConflictError,
    );
  });

  it("rejects register when legacy user does not exist", async () => {
    const { registerUserUseCase } = createService();

    await assert.rejects(
      () =>
        registerUserUseCase.execute({
          email: "available@example.com",
          firstName: "New",
          lastName: "User",
          legacyUser: "missing.user",
          password: "Password1!",
        }),
      LegacyUserNotFoundError,
    );
  });

  it("rejects register when legacy user is inactive", async () => {
    const { legacyUserVerifier, registerUserUseCase } = createService();
    legacyUserVerifier.users.set("inactive.user", {
      active: false,
      id: 20,
      userName: "inactive.user",
    });

    await assert.rejects(
      () =>
        registerUserUseCase.execute({
          email: "available@example.com",
          firstName: "New",
          lastName: "User",
          legacyUser: "inactive.user",
          password: "Password1!",
        }),
      LegacyUserInactiveError,
    );
  });

  it("does not hash or create user when legacy verification fails", async () => {
    const {
      legacyUserVerifier,
      passwordHasher,
      registerUserUseCase,
      userRepository,
    } = createService();
    legacyUserVerifier.failure = new LegacyServiceUnavailableError();

    await assert.rejects(
      () =>
        registerUserUseCase.execute({
          email: "available@example.com",
          firstName: "New",
          lastName: "User",
          legacyUser: "new.user",
          password: "Password1!",
        }),
      LegacyServiceUnavailableError,
    );

    assert.deepEqual(passwordHasher.hashedPasswords, []);
    assert.equal(userRepository.users.length, 1);
  });

  it("logs in with email", async () => {
    const { loginUserUseCase } = createService();
    const session = await loginUserUseCase.execute({
      identifier: activeUser.email,
      metadata: {},
      password: "password",
    });

    assert.equal(session.user.email, activeUser.email);
    assert.equal(session.user.legacyUser, activeUser.legacyUser);
    assert.equal(session.tokens.refreshToken, "refresh-token-1");
    assert.equal("passwordHash" in session.user, false);
  });

  it("blocks login when email is not verified", async () => {
    const { loginUserUseCase, userRepository } = createService();
    userRepository.users[0] = {
      ...activeUser,
      emailVerified: false,
    };

    await assert.rejects(
      () =>
        loginUserUseCase.execute({
          identifier: activeUser.email,
          metadata: {},
          password: "password",
        }),
      EmailNotVerifiedError,
    );
  });

  it("verifies email with a valid code", async () => {
    const { registerUserUseCase, verifyEmailUseCase } = createService();
    await registerUserUseCase.execute({
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
      legacyUser: "new.user",
      password: "Password1!",
    });

    const user = await verifyEmailUseCase.execute({
      code: "123456",
      identifier: "new@example.com",
    });

    assert.equal(user.emailVerified, true);
  });

  it("verifies email with a legacy user identifier", async () => {
    const { registerUserUseCase, verifyEmailUseCase } = createService();
    await registerUserUseCase.execute({
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
      legacyUser: "new.user",
      password: "Password1!",
    });

    const user = await verifyEmailUseCase.execute({
      code: "123456",
      identifier: "new.user",
    });

    assert.equal(user.emailVerified, true);
  });

  it("rejects invalid email verification codes", async () => {
    const { registerUserUseCase, verifyEmailUseCase } = createService();
    await registerUserUseCase.execute({
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
      legacyUser: "new.user",
      password: "Password1!",
    });

    await assert.rejects(
      () =>
        verifyEmailUseCase.execute({
          code: "000000",
          identifier: "new@example.com",
        }),
      InvalidEmailVerificationCodeError,
    );
  });

  it("resends verification code for unverified users", async () => {
    const {
      accountVerificationEmailSender,
      emailVerificationRepository,
      resendVerificationCodeUseCase,
      userRepository,
      usersById,
    } = createService();
    const user = await userRepository.create({
      email: "pending@example.com",
      firstName: "Pending",
      lastName: "User",
      legacyUser: "pending.user",
      passwordHash: "hash",
    });
    usersById.set(user.id, user);

    await resendVerificationCodeUseCase.execute({
      identifier: "pending.user",
    });

    assert.equal(emailVerificationRepository.tokens.length, 1);
    assert.deepEqual(accountVerificationEmailSender.sentEmails, [
      {
        code: "123456",
        to: "pending@example.com",
      },
    ]);
  });

  it("rate limits verification code resend after 5 attempts", async () => {
    const { resendVerificationCodeUseCase, userRepository, usersById } =
      createService();
    const user = await userRepository.create({
      email: "pending@example.com",
      firstName: "Pending",
      lastName: "User",
      legacyUser: "pending.user",
      passwordHash: "hash",
    });
    usersById.set(user.id, user);

    for (let index = 0; index < 5; index += 1) {
      await resendVerificationCodeUseCase.execute({
        identifier: "pending.user",
      });
    }

    await assert.rejects(
      () =>
        resendVerificationCodeUseCase.execute({
          identifier: "pending.user",
        }),
      TooManyEmailRequestsError,
    );
  });

  it("logs in with legacy user", async () => {
    const { loginUserUseCase } = createService();
    const session = await loginUserUseCase.execute({
      identifier: activeUser.legacyUser,
      metadata: {},
      password: "password",
    });

    assert.equal(session.user.id, activeUser.id);
  });

  it("allows login for users pending area assignment", async () => {
    const { loginUserUseCase, userRepository } = createService();
    userRepository.users[0] = {
      ...activeUser,
      state: USER_STATE.PENDING_AREA_ASSIGNMENT,
      workflowOwnerId: null,
      workflowOwner: null,
    };

    const session = await loginUserUseCase.execute({
      identifier: activeUser.email,
      metadata: {},
      password: "password",
    });

    assert.equal(session.user.state, USER_STATE.PENDING_AREA_ASSIGNMENT);
    assert.equal(session.user.workflowOwnerId, null);
    assert.equal(session.user.workflowOwner, null);
  });

  it("rejects invalid passwords with a generic credentials error", async () => {
    const refreshTokenRepository = new FakeRefreshTokenRepository();
    const passwordHasher = new FakePasswordHasher();
    passwordHasher.shouldMatch = false;
    const loginUserUseCase = new LoginUserUseCase({
      accessTokenService: new FakeAccessTokenService(),
      config: {
        accessTokenTtlMinutes: 15,
        emailVerificationCodeTtlMinutes: 15,
        emailSendRateLimitMax: 5,
        emailSendRateLimitWindowMinutes: 15,
        refreshTokenTtlDays: 7,
      },
      passwordHasher,
      refreshTokenRepository,
      refreshTokenService: new FakeRefreshTokenService(),
      userRepository: new FakeUserRepository(),
    });

    await assert.rejects(
      () =>
        loginUserUseCase.execute({
          identifier: activeUser.email,
          metadata: {},
          password: "bad-password",
        }),
      InvalidCredentialsError,
    );
  });

  it("rejects inactive or deleted users because repositories hide them", async () => {
    const { loginUserUseCase, userRepository } = createService();
    userRepository.users = [];

    await assert.rejects(
      () =>
        loginUserUseCase.execute({
          identifier: activeUser.email,
          metadata: {},
          password: "password",
        }),
      InvalidCredentialsError,
    );
  });

  it("rotates refresh tokens", async () => {
    const { loginUserUseCase, refreshSessionUseCase, refreshTokenRepository } =
      createService();
    const loginSession = await loginUserUseCase.execute({
      identifier: activeUser.email,
      metadata: {},
      password: "password",
    });
    const refreshedSession = await refreshSessionUseCase.execute({
      metadata: {},
      refreshToken: loginSession.tokens.refreshToken,
    });

    assert.equal(refreshedSession.tokens.refreshToken, "refresh-token-2");
    assert.deepEqual(refreshTokenRepository.revokedTokenHashes, [
      "hash:refresh-token-1",
    ]);
    assert.ok(
      refreshTokenRepository.tokens.has("hash:refresh-token-2"),
      "new refresh token should be stored",
    );
  });

  it("revokes the current refresh token on logout", async () => {
    const { loginUserUseCase, logoutUserUseCase, refreshTokenRepository } =
      createService();
    const loginSession = await loginUserUseCase.execute({
      identifier: activeUser.email,
      metadata: {},
      password: "password",
    });

    await logoutUserUseCase.execute(loginSession.tokens.refreshToken);

    assert.deepEqual(refreshTokenRepository.revokedTokenHashes, [
      "hash:refresh-token-1",
    ]);
  });

  it("returns current user without sensitive fields", async () => {
    const { getCurrentUserUseCase, loginUserUseCase } = createService();
    const loginSession = await loginUserUseCase.execute({
      identifier: activeUser.email,
      metadata: {},
      password: "password",
    });
    const currentUser = await getCurrentUserUseCase.execute(
      loginSession.tokens.accessToken,
    );

    assert.deepEqual(currentUser, {
      email: activeUser.email,
      emailVerified: activeUser.emailVerified,
      firstName: activeUser.firstName,
      id: activeUser.id,
      isSystemAdmin: activeUser.isSystemAdmin,
      lastName: activeUser.lastName,
      legacyUser: activeUser.legacyUser,
      recibeAsignacionAutomatica: false,
      state: activeUser.state,
      workflowOwnerId: activeUser.workflowOwnerId,
      workflowOwner: activeUser.workflowOwner,
    });
  });

  it("returns workflowOwner as null when the current user has no owner", async () => {
    const { getCurrentUserUseCase, loginUserUseCase, userRepository } = createService();
    userRepository.users[0] = {
      ...activeUser,
      workflowOwnerId: null,
      workflowOwner: null,
    };

    const loginSession = await loginUserUseCase.execute({
      identifier: activeUser.email,
      metadata: {},
      password: "password",
    });
    const currentUser = await getCurrentUserUseCase.execute(
      loginSession.tokens.accessToken,
    );

    assert.equal(currentUser.workflowOwnerId, null);
    assert.equal(currentUser.workflowOwner, null);
  });
});
