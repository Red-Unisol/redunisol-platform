import assert from "node:assert/strict";
import { it } from "node:test";
import {
  actingContext,
  actingHistoryFields,
  type ActingContext,
} from "./context";
import { AuthController } from "../presentation/AuthController";
import type { Response } from "express";

it("refresh conserva los tokens del administrador y devuelve el usuario efectivo", async () => {
  const context = {
    sessionId: "session",
    auditId: "audit",
    administrator: { id: "admin", isSystemAdmin: true },
    selectedUser: { id: "seller", isSystemAdmin: false },
  } as ActingContext;
  const cookies: Record<string, unknown> = {};
  let body: unknown;
  const controller = new AuthController({
    refreshSessionUseCase: {
      execute: async () => ({
        user: context.administrator,
        tokens: {
          accessToken: "admin-access",
          refreshToken: "admin-refresh",
          accessTokenExpiresAt: new Date(),
          refreshTokenExpiresAt: new Date(),
        },
      }),
    },
    authCookieConfig: {
      accessTokenTtlMinutes: 30,
      refreshTokenTtlDays: 7,
      isProduction: false,
    },
  } as never);
  const res = {
    cookie(name: string, value: unknown) {
      cookies[name] = value;
      return this;
    },
    status() {
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as unknown as Response;
  await actingContext.run(context, async () => {
    await controller.refresh(
      {
        cookies: { refreshToken: "admin-refresh" },
        headers: {},
        get: () => undefined,
      } as never,
      res,
      (error) => {
        if (error) throw error;
      },
    );
    assert.deepEqual(body, { user: context.selectedUser });
    assert.deepEqual(cookies, {
      accessToken: "admin-access",
      refreshToken: "admin-refresh",
    });
    assert.deepEqual(actingHistoryFields(), {
      realActorUserId: "admin",
      impersonationSessionId: "session",
      operationAuditId: "audit",
    });
  });
  assert.deepEqual(actingHistoryFields(), {});
});

it("no mezcla identidades entre operaciones concurrentes", async () => {
  await Promise.all(
    ["a", "b"].map((id) =>
      actingContext.run(
        {
          sessionId: id,
          auditId: id,
          administrator: { id },
          selectedUser: { id: `target-${id}` },
        } as ActingContext,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          assert.equal(actingHistoryFields().realActorUserId, id);
        },
      ),
    ),
  );
  assert.equal(actingContext.getStore(), undefined);
});
