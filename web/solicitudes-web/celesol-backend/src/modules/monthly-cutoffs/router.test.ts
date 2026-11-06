import assert from "node:assert/strict";
import { it } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import { ACCESS_TOKEN_COOKIE } from "../auth/presentation/AuthCookies";
import type { AddressInfo } from "node:net";
import { createMonthlyCutoffRouter } from "./router";
import { MonthlyCutoffService, type CutoffRepository } from "./domain";
import type { AuthUser } from "../auth/domain/entities/User.entity";

it("authenticates reads, denies seller writes and validates analyst input on the server", async () => {
  let writes = 0;
  const repository: CutoffRepository = {
    find: async () => null,
    history: async () => [],
    save: async () => {
      writes++;
      throw Error("not needed");
    },
  };
  const actor = (code: string): AuthUser => ({
    id: "u",
    email: "analyst@example.invalid",
    emailVerified: true,
    firstName: "Ejemplo",
    lastName: null,
    legacyUser: "ejemplo",
    isSystemAdmin: false,
    state: 1,
    recibeAsignacionAutomatica: false,
    workflowOwnerId: "r",
    workflowOwner: { code, id: "r", name: code },
  });
  const app = express();
  app.use(express.json(), cookieParser());
  app.use(
    createMonthlyCutoffRouter(
      {
        execute: async (token) => {
          if (!token)
            throw Object.assign(Error("Sesión inválida"), { statusCode: 401 });
          return actor(token === "analyst" ? "RIESGO" : "VENDEDORES");
        },
      },
      new MonthlyCutoffService(repository),
    ),
  );
  app.use(((error, _req, res, _next) => {
    res.status(error.statusCode ?? 500).json({ message: error.message });
  }) as ErrorRequestHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url =
    "http://127.0.0.1:" +
    (server.address() as AddressInfo).port +
    "/amejuca/2026-11";
  const request = (token?: string, body?: unknown) =>
    fetch(url, {
      method: body ? "PUT" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Cookie: ACCESS_TOKEN_COOKIE + "=" + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal((await request()).status, 401);
    const response = await request("seller");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).canManage, false);
    assert.equal(
      (
        await request("seller", {
          cutoffDate: "2026-11-08",
          expectedVersion: 0,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("analyst", {
          cutoffDate: "2026-12-08",
          expectedVersion: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("analyst", {
          cutoffDate: "2026-11-08",
          expectedVersion: -1,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("analyst", {
          cutoffDate: "2026-11-08",
          expectedVersion: 0,
          isSystemAdmin: true,
        })
      ).status,
      400,
    );
    assert.equal(writes, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
