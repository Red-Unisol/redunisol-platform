import assert from "node:assert/strict";
import test from "node:test";
import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import { ACCESS_TOKEN_COOKIE } from "../auth/presentation/AuthCookies";
import { createPadronesRouter } from "./router";

test("only authorized application readers can look up its current titular; failures never masquerade as no matches", async () => {
  let sourceReads = 0,
    lookups = 0,
    sourceFails = false,
    providerFails = false,
    configured = true,
    dni: string | null = "12.345.678";
  const id = "00000000-0000-4000-8000-000000000001";
  const app = express();
  app.use(cookieParser());
  app.use(
    createPadronesRouter({
      auth: {
        execute: async (token) => {
          if (!token)
            throw Object.assign(new Error("No session"), { statusCode: 401 });
          return {
            isSystemAdmin: token === "admin",
            workflowOwner: {
              code: token === "seller" ? "VENDEDORES" : "RIESGO",
            },
          } as AuthUser;
        },
      },
      source: async (sourceId) => {
        sourceReads++;
        assert.equal(sourceId, id);
        if (sourceFails)
          throw Object.assign(new Error("No access to application"), {
            statusCode: 403,
          });
        return { dni, cuit: null };
      },
      gateway: {
        configured: () => configured,
        lookup: async (document) => {
          lookups++;
          assert.equal(document, "12345678");
          if (providerFails)
            throw new Error(
              "private upstream credential must not reach the browser",
            );
          return { document, queried_at: "2026-11-11T12:00:00Z", sources: [] };
        },
      },
    }),
  );
  app.use(((error, _req, res, _next) =>
    res
      .status(error.statusCode ?? 500)
      .json({ message: error.message })) as ErrorRequestHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${id}/padrones`;
  const read = (token?: string, suffix = "") =>
    fetch(url + suffix, {
      headers: token ? { Cookie: `${ACCESS_TOKEN_COOKIE}=${token}` } : {},
    });
  try {
    assert.equal((await read()).status, 401);
    assert.equal((await read("seller")).status, 403);
    assert.equal(sourceReads, 0);
    assert.equal(lookups, 0);
    sourceFails = true;
    assert.equal((await read("analyst")).status, 403);
    assert.equal(lookups, 0);
    sourceFails = false;
    const success = await read("analyst", "?document=87654321");
    assert.equal((await success.json()).status, "available");
    assert.match(success.headers.get("cache-control") ?? "", /no-store/);
    providerFails = true;
    assert.deepEqual(await (await read("admin")).json(), {
      status: "unavailable",
    });
    providerFails = false;
    configured = false;
    assert.deepEqual(await (await read("analyst")).json(), {
      status: "not_configured",
    });
    dni = null;
    assert.deepEqual(await (await read("analyst")).json(), {
      status: "missing_document",
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
