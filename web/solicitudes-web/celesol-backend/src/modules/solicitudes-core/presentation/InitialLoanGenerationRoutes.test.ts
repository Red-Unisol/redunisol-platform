import assert from "node:assert/strict";
import { after, it } from "node:test";
import express from "express";
import { addInitialLoanGenerationRoutes } from "./InitialLoanGenerationRoutes";

const id = "e4b0e1c4-aab8-45f6-8c9b-7f4e6fce156d";
const requestId = "fd7560c9-5930-4ea7-9ea8-05b01c967bd5";
const calls: string[] = [];
const app = express(); app.use(express.json());
addInitialLoanGenerationRoutes(app, {
  auth: { execute: async () => ({ id: "admin", isSystemAdmin: true, workflowOwnerId: "risk" }) },
  access: async () => { calls.push("access"); },
  checkService: {
    check: async () => { calls.push("check"); return { status: "empty" }; },
    release: async () => { calls.push("release"); return { released: true }; },
    recover: async () => { calls.push("recover-checked"); return {}; },
  }, service: { recover: async () => ({}) },
} as unknown as Parameters<typeof addInitialLoanGenerationRoutes>[1]);
app.use((error: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.statusCode ?? 500).json({ error: { message: error.message } });
});
const server = app.listen(0, "127.0.0.1");
after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
const send = async (action: string, body: unknown) => {
  if (!server.listening) await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  return fetch(`http://127.0.0.1:${address.port}/${id}/loan-generation/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
};
it("manual recheck checks detail visibility, is non-cacheable and never dispatches a creation or mutation", async () => {
  calls.length = 0;
  const response = await send("check", { requestId, expectedUpdatedAt: "2026-11-17T12:00:00Z" });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, ["access", "check"]);
});
it("release/recover require a reason and exact version and reject client-supplied safety flags", async () => {
  for (const action of ["release", "recover-checked"]) {
    calls.length = 0;
    const response = await send(action, { requestId, expectedUpdatedAt: "2026-11-17T12:00:00Z", canRelease: true });
    assert.equal(response.status, 400); assert.deepEqual(calls, ["access"]);
  }
});
