import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { RefreshSessionUseCase } from "../../application/use-cases/RefreshSession.use-case";
import { LogoutUserUseCase } from "../../application/use-cases/LogoutUser.use-case";
import { InvalidSessionError } from "../../domain/auth-errors";
import { AuthRepositoryImpl } from "../repositories/AuthRepositoryImpl";
import { RefreshTokenRepositoryImpl } from "../repositories/RefreshTokenRepositoryImpl";
import { JwtTokenService } from "../services/JwtTokenService";
import { OpaqueRefreshTokenService } from "../services/OpaqueRefreshTokenService";
import { AuthPrismaDatasource } from "./AuthPrismaDatasource";
import { RefreshTokenPrismaDatasource } from "./RefreshTokenPrismaDatasource";

const url = process.env.BEEX_TEST_DATABASE_URL;

it(
  "PostgreSQL: concurrent recovery, lost commit acknowledgement, logout and password reset",
  { skip: !url },
  async () => {
    const target = new URL(url!);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
        target.pathname.endsWith("_test"),
      "Use an isolated local *_test database",
    );
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    const userId = randomUUID();
    try {
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`,
          legacyUser: userId,
          passwordHash: "test-only",
          emailVerified: true,
          state: 1,
        },
      });
      const users = new AuthRepositoryImpl(new AuthPrismaDatasource(prisma));
      const tokens = new RefreshTokenRepositoryImpl(
        new RefreshTokenPrismaDatasource(prisma),
      );
      const service = new OpaqueRefreshTokenService(
        "test-only-key-for-session-recovery",
      );
      const refresh = new RefreshSessionUseCase({
        userRepository: users,
        refreshTokenRepository: tokens,
        refreshTokenService: service,
        accessTokenService: new JwtTokenService({
          secret: "test-only-key-for-session-recovery",
          ttlMinutes: 15,
        }),
        config: {
          accessTokenTtlMinutes: 15,
          refreshTokenTtlDays: 7,
          emailVerificationCodeTtlMinutes: 15,
          emailSendRateLimitMax: 5,
          emailSendRateLimitWindowMinutes: 15,
        },
      });
      const original = service.generate();
      await tokens.create({
        tokenHash: service.hash(original),
        userId,
        expiresAt: new Date(Date.now() + 60_000),
        metadata: {},
      });
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          refresh.execute({ refreshToken: original, metadata: {} }),
        ),
      );
      assert.equal(
        new Set(responses.map((s) => s.tokens.refreshToken)).size,
        1,
      );
      assert.equal(
        new Set(
          responses.map((s) => s.tokens.refreshTokenExpiresAt.toISOString()),
        ).size,
        1,
      );
      assert.equal(await prisma.refreshToken.count({ where: { userId } }), 2);
      assert.equal(
        await prisma.refreshToken.count({ where: { userId, revokedAt: null } }),
        1,
      );

      const successor = responses[0].tokens.refreshToken;
      const rotate = tokens.rotate.bind(tokens);
      tokens.rotate = async (input) => {
        await rotate(input);
        throw new Error("simulated lost commit acknowledgement");
      };
      const recovered = await refresh.execute({
        refreshToken: successor,
        metadata: {},
      });
      assert.equal(recovered.tokens.refreshToken, service.successor(successor));
      tokens.rotate = rotate;

      const logout = new LogoutUserUseCase({
        refreshTokenRepository: tokens,
        refreshTokenService: service,
      });
      await logout.execute(successor);
      for (const refreshToken of [successor, recovered.tokens.refreshToken]) {
        await assert.rejects(
          () => refresh.execute({ refreshToken, metadata: {} }),
          InvalidSessionError,
        );
      }

      const secondLogin = service.generate();
      await tokens.create({
        tokenHash: service.hash(secondLogin),
        userId,
        expiresAt: new Date(Date.now() + 60_000),
        metadata: {},
      });
      const next = await refresh.execute({
        refreshToken: secondLogin,
        metadata: {},
      });
      await users.updatePasswordAndRevokeSessions({
        userId,
        passwordHash: "test-only-new-password",
      });
      for (const refreshToken of [secondLogin, next.tokens.refreshToken]) {
        await assert.rejects(
          () => refresh.execute({ refreshToken, metadata: {} }),
          InvalidSessionError,
        );
      }
    } finally {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  },
);
