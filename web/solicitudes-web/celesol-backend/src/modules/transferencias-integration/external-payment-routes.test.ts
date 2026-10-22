import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import { ACCESS_TOKEN_COOKIE } from "../auth/presentation/AuthCookies";
import { addExternalPaymentRoutes } from "./external-payment-routes";
import { IntegrationError } from "./domain";

test("web payment endpoint authenticates before bounded multipart and permits no comment", async (t) => {
  const user: AuthUser = {
    id: randomUUID(),
    email: "synthetic@example.invalid",
    emailVerified: true,
    firstName: null,
    lastName: null,
    legacyUser: "synthetic",
    state: 1,
    isSystemAdmin: false,
    recibeAsignacionAutomatica: false,
    workflowOwnerId: randomUUID(),
  };
  let calls = 0;
  const router = express.Router();
  addExternalPaymentRoutes(router, {
    auth: {
      execute: async (token) => {
        if (token !== "synthetic-session")
          throw new IntegrationError("UNAUTHORIZED", "Iniciá sesión.", 401);
        return user;
      },
    },
    maxFileBytes: 64,
    service: {
      view: async () => ({
        canRegister: true,
        blockedReason: null,
        reservationPending: true,
        payment: null,
      }),
      register: async (_id, actor, input) => {
        assert.equal(actor.id, user.id);
        assert.equal(input.comment, "");
        calls++;
        return {
          canRegister: false,
          blockedReason: null,
          reservationPending: false,
          payment: null,
        };
      },
    },
  });
  const app = express();
  app.use(cookieParser());
  app.use(router);
  const errors: ErrorRequestHandler = (e, _req, res, _next) =>
    res.status(e.statusCode ?? 500).json({ error: { message: e.message } });
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const addr = server.address();
  assert(addr && typeof addr !== "string");
  const url = `http://127.0.0.1:${addr.port}/${randomUUID()}/pago-externo`;
  const headers = { Cookie: `${ACCESS_TOKEN_COOKIE}=synthetic-session` };
  const body = (file?: string) => {
    const form = new FormData();
    form.set("requestId", randomUUID());
    form.set("paidOn", "2026-10-20");
    form.set("reference", "BANK-123");
    if (file !== undefined)
      form.set(
        "file",
        new Blob([file], { type: "application/pdf" }),
        "receipt.pdf",
      );
    return form;
  };
  assert.equal((await fetch(url)).status, 401);
  assert.equal(
    (await fetch(url, { method: "POST", body: body("x".repeat(100)) })).status,
    401,
  );
  assert.equal(
    (await fetch(url, { headers })).headers.get("Cache-Control"),
    "no-store",
  );
  assert.equal(
    (await fetch(url, { method: "POST", headers, body: body() })).status,
    400,
  );
  assert.equal(
    (await fetch(url, { method: "POST", headers, body: body("x".repeat(100)) }))
      .status,
    413,
  );
  const invalid = body("%PDF-1.7\n%%EOF");
  invalid.set("paidOn", "2026-02-30");
  assert.equal(
    (await fetch(url, { method: "POST", headers, body: invalid })).status,
    400,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers,
        body: body("%PDF-1.7\n%%EOF"),
      })
    ).status,
    200,
  );
  assert.equal(calls, 1);
});
