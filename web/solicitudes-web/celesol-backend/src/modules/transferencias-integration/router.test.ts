import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { hash } from "./domain";
import { createTransferenciasRouter, tokenMatches } from "./router";
import { integrationConfigSchema } from "./config";
import type { TransferenciasService } from "./TransferenciasService";

const token = "only-a-synthetic-test-token-1234567890";
test("constant-time token check rejects cookies, missing, short and wrong tokens", () => {
  assert.equal(tokenMatches(`Bearer ${token}`, hash(token)), true);
  for (const value of [
    undefined,
    "",
    "Bearer short",
    `Bearer ${token}x`,
    `Basic ${token}`,
  ])
    assert.equal(tokenMatches(value, hash(token)), false);
  assert.equal(
    integrationConfigSchema.safeParse({ tokenSha256: hash(token) }).success,
    false,
  );
  assert.equal(integrationConfigSchema.safeParse({}).success, true);
});
test("HTTP auth precedes multipart processing and validates service role and input", async (t) => {
  let enabled = true;
  let admin = false;
  let active = true;
  let calls = 0;
  const config = {
    tokenSha256: hash(token),
    userId: randomUUID(),
    clientId: "test",
  };
  const service = {
    list: async () => {
      calls++;
      return { items: [], nextCursor: null };
    },
  } as unknown as TransferenciasService;
  const app = express();
  app.use(express.json());
  app.use(
    createTransferenciasRouter({
      config,
      service,
      maxFileBytes: 10,
      findUser: async () =>
        enabled
          ? {
              id: config.userId,
              state: active ? 1 : 0,
              deletedAt: null,
              isSystemAdmin: admin,
              workflowOwner: {
                id: randomUUID(),
                code: "TESORERIA",
                isActive: true,
              },
            }
          : null,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const root = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(root + "/solicitudes", { headers })).status, 200);
  assert.equal(calls, 1);
  assert.equal(
    (await fetch(root + "/solicitudes?limit=101", { headers })).status,
    400,
  );
  assert.equal(
    (await fetch(root + "/solicitudes/not-uuid/plan", { headers })).status,
    400,
  );
  assert.equal(
    (
      await fetch(root + "/solicitudes", {
        headers: { Cookie: "accessToken=anything" },
      })
    ).status,
    401,
  );
  admin = true;
  assert.equal((await fetch(root + "/solicitudes", { headers })).status, 403);
  admin = false;
  active = false;
  assert.equal((await fetch(root + "/solicitudes", { headers })).status, 403);
  active = true;
  enabled = false;
  assert.equal((await fetch(root + "/solicitudes", { headers })).status, 403);
  enabled = true;
  const form = new FormData();
  form.append(
    "file",
    new Blob(["%PDF-12345678901234567890%%EOF"], { type: "application/pdf" }),
    "test.pdf",
  );
  const url = root + `/desembolsos/${randomUUID()}/comprobante`;
  assert.equal((await fetch(url, { method: "POST", body: form })).status, 401);
  assert.equal(
    (await fetch(url, { method: "POST", body: form, headers })).status,
    413,
  );
  config.tokenSha256 = "";
  assert.equal((await fetch(root + "/solicitudes", { headers })).status, 404);
});
