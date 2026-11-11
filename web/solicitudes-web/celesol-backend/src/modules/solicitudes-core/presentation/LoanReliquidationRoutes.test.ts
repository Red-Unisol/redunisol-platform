import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import type { AddressInfo } from "node:net";
import express, { Router, type ErrorRequestHandler } from "express";
import type { AuthUser } from "../../auth/domain/entities/User.entity";
import { addLoanReliquidationRoutes } from "./LoanReliquidationRoutes";
import { AdministrativeCorrectionError } from "../domain/workflow/AdministrativeCorrection";

it("reliquidation routes authenticate, reject bypass fields and delegate only the explicit operation", async () => {
  const app = express(), router = Router(), calls: string[] = [];
  let authenticated = true;
  const view = { visible: true, pending: false, prepared: false, requestId: undefined, reason: undefined, canReopen: true, blockedReason: null, updatedAt: new Date().toISOString(), previousLoanId: "555" };
  addLoanReliquidationRoutes(router, { auth: { execute: async () => {
    if (!authenticated) throw new AdministrativeCorrectionError("Sin sesión", 401);
    return { id: randomUUID() } as AuthUser;
  } }, service: {
    view: async () => { calls.push("view"); return view; },
    prepare: async () => { calls.push("prepare"); return view; },
    reopen: async () => { calls.push("reopen"); return view; },
  } });
  app.use(express.json(), router);
  app.use(((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ message: error.message })) as ErrorRequestHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${randomUUID()}/reliquidacion`;
  const input = { requestId: randomUUID(), expectedUpdatedAt: view.updatedAt, previousLoanId: "555", reason: "Corrección solicitada por Riesgo" };
  const post = (body: unknown, suffix = "") => fetch(url + suffix, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await post({ ...input, skipCancellationCheck: true })).status, 400);
    assert.equal((await post(input, "/preparar")).status, 200);
    assert.equal((await post(input)).status, 200);
    authenticated = false;
    assert.equal((await post(input)).status, 401);
    assert.deepEqual(calls, ["view", "prepare", "reopen"]);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
