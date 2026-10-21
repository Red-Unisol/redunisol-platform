import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, it } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import { prisma } from "../../../db/prisma";
import type { AuthUser } from "../domain/entities/User.entity";
import type { AuthRepository } from "../domain/repositories/AuthRepository";
import type { RefreshTokenRepository } from "../domain/repositories/RefreshTokenRepository";
import { GetCurrentUserUseCase } from "../application/use-cases/GetCurrentUser.use-case";
import { Impersonation } from "./Impersonation";
import { actingContext, actingHistoryFields } from "./context";

after(() => prisma.$disconnect());
it("HTTP impersonation: real admin validation, effective permissions, return, audit and revoked identities", async () => {
  const admin: AuthUser = {
    id: randomUUID(),
    email: "admin@example.test",
    firstName: "Admin",
    lastName: null,
    emailVerified: true,
    legacyUser: "admin",
    state: 1,
    isSystemAdmin: true,
    recibeAsignacionAutomatica: false,
    workflowOwnerId: randomUUID(),
  };
  const target: AuthUser = {
    ...admin,
    id: randomUUID(),
    email: "seller@example.test",
    isSystemAdmin: false,
    workflowOwnerId: randomUUID(),
    workflowOwner: { id: randomUUID(), code: "VENDEDORES", name: "Vendedores" },
  };
  const other = { ...admin, id: randomUUID() };
  const pending = {
    ...target,
    id: randomUUID(),
    state: 2,
    workflowOwnerId: null,
  };
  const inactive = { ...target, id: randomUUID(), state: 0 };
  const users = new Map(
    [admin, target, other, pending, inactive].map((user) => [user.id, user]),
  );
  const repository = {
    findById: async (id: string) => users.get(id) ?? null,
    findActiveById: async (id: string) => {
      const user = users.get(id);
      return user && user.state !== 0 ? user : null;
    },
  } as AuthRepository;
  const accessTokens = {
    sign: ({ userId }: { userId: string }) => userId,
    verify: (token: string) => {
      if (!users.has(token))
        throw Object.assign(new Error("expired"), { statusCode: 401 });
      return { userId: token };
    },
  };
  let rotatedAt: Date | null = null;
  const refreshTokens = {
    findByHash: async (token: string) =>
      token === "refresh-admin" || (rotatedAt && token === "next:refresh-admin")
        ? {
            id: randomUUID(),
            userId: admin.id,
            user: admin,
            expiresAt: new Date(Date.now() + 600000),
            revokedAt: token === "refresh-admin" ? rotatedAt : null,
            replacedByTokenHash:
              token === "refresh-admin" && rotatedAt
                ? "next:refresh-admin"
                : null,
            tokenHash: token,
          }
        : null,
  } as RefreshTokenRepository;
  const service = new Impersonation({
    prisma,
    users: repository,
    accessTokens,
    refreshTokens,
    refreshService: {
      hash: (s) => s,
      generate: () => "unused",
      successor: (s) => `next:${s}`,
    },
    secure: false,
    origin: "https://app.example.test",
  });
  const current = new GetCurrentUserUseCase({
    accessTokenService: accessTokens,
    userRepository: repository,
  });
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/auth/impersonation", service.router());
  app.use(service.middleware);
  app.get("/auth/me", async (req, res, next) => {
    try {
      res.json(await current.execute(req.cookies.accessToken));
    } catch (e) {
      next(e);
    }
  });
  app.post("/operation", async (req, res, next) => {
    try {
      const user = await current.execute(req.cookies.accessToken);
      res.json({
        userId: user.id,
        ownerId: user.workflowOwnerId,
        fields: actingHistoryFields(),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/admin-operation", async (req, res, next) => {
    try {
      const user = await current.execute(req.cookies.accessToken);
      res
        .status(user.isSystemAdmin ? 200 : 403)
        .json({ allowed: user.isSystemAdmin });
    } catch (e) {
      next(e);
    }
  });
  app.post("/auth/refresh", (_req, res) =>
    res.json({ user: actingContext.getStore()?.selectedUser }),
  );
  app.post("/auth/logout", (_req, res) => res.sendStatus(204));
  app.use(((error, _req, res, _next) =>
    res
      .status(error.statusCode ?? 500)
      .json({ error: error.message })) as ErrorRequestHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert(addr && typeof addr !== "string");
  let cookie = `accessToken=${admin.id}; refreshToken=refresh-admin`;
  const request = async (path: string, body?: unknown, customCookie = cookie) =>
    fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie: customCookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await request(
          "/auth/impersonation/start",
          { userId: target.id },
          `accessToken=${target.id}`,
        )
      ).status,
      403,
    );
    for (const user of [admin, pending, inactive])
      assert.equal(
        (await request("/auth/impersonation/start", { userId: user.id }))
          .status,
        400,
      );
    const started = await request("/auth/impersonation/start", {
      userId: target.id,
    });
    assert.equal(started.status, 200);
    const sessionId = started.headers
      .get("set-cookie")!
      .match(/actingSession=([^;]+)/)![1];
    cookie += `; actingSession=${sessionId}`;
    assert.equal(
      (await request("/auth/impersonation/start", { userId: other.id })).status,
      409,
    );
    const me = await (await request("/auth/me")).json();
    assert.equal(me.id, target.id);
    assert.equal(me.isSystemAdmin, false);
    const operation = await (await request("/operation", {})).json();
    assert.equal(operation.userId, target.id);
    assert.equal(operation.ownerId, target.workflowOwnerId);
    assert.equal(operation.fields.realActorUserId, admin.id);
    assert.equal(operation.fields.impersonationSessionId, sessionId);
    const record = await prisma.impersonationOperation.findUniqueOrThrow({
      where: { id: operation.fields.operationAuditId },
    });
    assert.equal(record.administratorId, admin.id);
    assert.equal(record.selectedUserId, target.id);
    assert.equal(record.action, "POST /operation");
    assert.equal((await request("/admin-operation", {})).status, 403);
    assert.equal(
      (await request("/auth/me", undefined, cookie.replace(admin.id, other.id)))
        .status,
      403,
    );
    // A lost renewal response left this browser with the replaced token.
    rotatedAt = new Date();
    const renewed = await request(
      "/auth/refresh",
      {},
      cookie.replace(admin.id, "expired"),
    );
    assert.equal(renewed.status, 200);
    assert.equal((await renewed.json()).user.id, target.id);
    assert.equal(
      (
        await request(
          "/auth/refresh",
          {},
          cookie.replace("refresh-admin", "invalid"),
        )
      ).status,
      401,
    );
    target.state = 0;
    assert.equal((await request("/operation", {})).status, 403);
    const info = await request("/auth/impersonation");
    assert.equal(info.status, 200);
    assert.equal(
      (
        await request(
          "/auth/impersonation/stop",
          {},
          cookie.replace(admin.id, "expired"),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await prisma.impersonationSession.findUniqueOrThrow({
          where: { id: sessionId },
        })
      ).endReason,
      "RETURN",
    );
    assert.equal((await request("/operation", {})).status, 409); // ended cookie cannot keep operating
    const denied = await prisma.impersonationOperation.findFirstOrThrow({
      where: { sessionId, action: "POST /admin-operation" },
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.administratorId, admin.id);
    assert.equal(denied.selectedUserId, target.id);
    cookie = `accessToken=${admin.id}; refreshToken=refresh-admin`;
    target.state = 1;
    assert.equal((await (await request("/auth/me")).json()).id, admin.id);
    const again = await request("/auth/impersonation/start", {
      userId: other.id,
    });
    const second = again.headers
      .get("set-cookie")!
      .match(/actingSession=([^;]+)/)![1];
    cookie += `; actingSession=${second}`;
    assert.equal(
      (await request("/auth/impersonation/start", { userId: target.id }))
        .status,
      409,
    ); // even selected admins cannot chain
    admin.isSystemAdmin = false;
    assert.equal((await request("/operation", {})).status, 403);
    admin.isSystemAdmin = true;
    assert.equal(
      (await request("/auth/logout", {}, cookie.replace(admin.id, "expired")))
        .status,
      204,
    );
    assert.equal(
      (
        await prisma.impersonationSession.findUniqueOrThrow({
          where: { id: second },
        })
      ).endReason,
      "LOGOUT",
    );
    assert.equal(
      await prisma.impersonationOperation.count({
        where: { administratorId: admin.id, action: "START" },
      }),
      2,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.impersonationOperation.deleteMany({
      where: { administratorId: admin.id },
    });
    await prisma.impersonationSession.deleteMany({
      where: { administratorId: admin.id },
    });
  }
});
