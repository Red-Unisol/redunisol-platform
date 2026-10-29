import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import express, { type ErrorRequestHandler } from "express";
import type { AuthUser } from "../../auth/domain/entities/User.entity";
import { AdministrativeCorrectionError } from "../domain/workflow/AdministrativeCorrection";
import { addRefinanciacionCobrosRoutes, refinanciacionRecoveryInput } from "./RefinanciacionCobrosRoutes";

it("reconciliation requires an operation, version, reason and a complete result; identity and selection are server-owned", () => {
  const base = { operationId: randomUUID(), expectedUpdatedAt: new Date().toISOString(), reason: "Verificado en Vimarx por administración" };
  assert(refinanciacionRecoveryInput.safeParse({ ...base, resolution: "NOT_APPLIED" }).success);
  const confirmed = { ...base, resolution: "CONFIRMED", cobroId: "1234", totalCobrado: 120.53 };
  assert(refinanciacionRecoveryInput.safeParse(confirmed).success);
  for (const patch of [{ operationId: "" }, { reason: " " }, { cobroId: "0" }, { totalCobrado: 0 }, { totalCobrado: 1.001 }, { totalCobrado: Infinity }, { isSystemAdmin: true }, { currentUser: {} }, { nrosCuota: [24] }, { prestamoId: "123" }])
    assert(!refinanciacionRecoveryInput.safeParse({ ...confirmed, ...patch }).success);
  assert(!refinanciacionRecoveryInput.safeParse({ ...base, resolution: "NOT_APPLIED", cobroId: "1234" }).success);
});

it("HTTP reconciliation uses the authenticated identity, returns private responses and rejects malformed bodies", async () => {
  const app = express(); app.use(express.json());
  const router = express.Router();
  const user = { id: randomUUID(), isSystemAdmin: false } as AuthUser;
  const calls: unknown[] = [];
  addRefinanciacionCobrosRoutes(router, {
    auth: { execute: async () => user },
    service: {
      inspect: async (_id, actor) => {
        assert.equal(actor, user);
        throw new AdministrativeCorrectionError("Se requiere administrador", 403);
      },
      recover: async (_id, actor, input) => {
        assert.equal(actor, user); calls.push(input);
        throw new AdministrativeCorrectionError("Se requiere administrador", 403);
      },
    },
  });
  app.use("/solicitudes", router);
  const handler: ErrorRequestHandler = (error, _req, res, _next) => { res.status(error.statusCode ?? 500).json({ message: error.message }); };
  app.use(handler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/solicitudes/${randomUUID()}/refinanciacion`;
  try {
    const read = await fetch(`${url}/cobro-pendiente`);
    assert.equal(read.status, 403); assert.equal(read.headers.get("Cache-Control"), "no-store");
    const body = { operationId: randomUUID(), expectedUpdatedAt: new Date().toISOString(), resolution: "NOT_APPLIED", reason: "Revisado el cobro y las cuotas en Vimarx" };
    const denied = await fetch(`${url}/conciliar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(denied.status, 403); assert.equal(calls.length, 1);
    const invalid = await fetch(`${url}/conciliar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, isSystemAdmin: true }) });
    assert.equal(invalid.status, 400); assert.equal(calls.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
