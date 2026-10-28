import assert from "node:assert/strict";
import { it } from "node:test";
import { EvaluateListSolicitudesGateway } from "./EvaluateListSolicitudesGateway";

it("Core reconciliation uses read-only queries, resolves historical IDs and verifies the associated socio", async () => {
  const calls: { tipo: string; cmd: string }[] = [];
  const responses = [[[90]], [777, 600000, 12, 55, "2026-11-01", 0, 0], [777, 600000, 12, 55, "2026-11-01", 0, 0]];
  const gateway = new EvaluateListSolicitudesGateway({ baseUrl: "https://example.test", timeoutMs: 1000 }, async (url, init) => {
    assert.match(String(url), /Evaluate(List|Obj)/);
    calls.push(JSON.parse(String(init?.body)));
    return { ok: true, json: async () => responses.shift() };
  });
  const loan = await gateway.getCoreReconciliationSnapshot("123", "12345678");
  assert.equal(loan?.id, "777");
  assert.equal(loan?.amount, 600000);
  assert.match(calls[2]!.cmd, /ID\]=777 And Integrantes\[Socio.ID = 90\]/);
});

it("a historical loan with the wrong socio cannot fall back to a colliding direct loan ID", async () => {
  const responses = [[[90]], [777, 600000, 12, 55, "2026-11-01", 0, 0], []];
  let calls = 0;
  const gateway = new EvaluateListSolicitudesGateway({ baseUrl: "https://example.test", timeoutMs: 1000 }, async () => {
    calls++;
    return { ok: true, json: async () => responses.shift() };
  });
  assert.equal(await gateway.getCoreReconciliationSnapshot("123", "12345678"), null);
  assert.equal(calls, 3);
});

it("cancelled loan lifecycle resolves the historical ID without requiring titular membership", async () => {
  const responses = [[777], [777, 1016127, 3, "Anulada", 0, "Anulado", false, 0]];
  const calls: { tipo: string; cmd: string }[] = [];
  const gateway = new EvaluateListSolicitudesGateway({ baseUrl: "https://example.test", timeoutMs: 1000 }, async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return { ok: true, json: async () => responses.shift() };
  });
  const result = await gateway.getCoreLoanLifecycle("123");
  assert.equal(result?.id, "777"); assert.equal(result?.estadoLabel, "Anulada");
  assert.equal(result?.vigente, false); assert.equal(result?.saldo, 0);
  assert.equal(calls.length, 2); assert.equal(calls[1]!.cmd, "[ID]=777");
  assert(!calls.some(c => c.cmd.includes("Integrantes")));
});
it("a historical request without a loan never falls back to a colliding direct ID", async () => {
  let calls = 0;
  const gateway = new EvaluateListSolicitudesGateway({ baseUrl: "https://example.test", timeoutMs: 1000 }, async () => {
    calls++; return { ok: true, json: async () => [null] };
  });
  assert.equal(await gateway.getCoreLoanLifecycle("123"), null);
  assert.equal(calls, 1);
});

it("a replacement ID is queried directly, without confusing it with the historical ID space", async () => {
  const calls: {tipo: string; cmd: string}[] = [];
  const responses = [[[90]], [777, 600000, 12, 55, "2026-11-01", 0, 0]];
  const gateway = new EvaluateListSolicitudesGateway({ baseUrl: "https://example.test", timeoutMs: 1000 }, async (_url, init) => {
    calls.push(JSON.parse(String(init?.body))); return { ok: true, json: async () => responses.shift() };
  });
  assert.equal((await gateway.getCoreReconciliationSnapshot("777", "12345678", true))?.id, "777");
  assert.equal(calls.length, 2); assert(!calls.some(c => c.tipo.includes("PreSolicitud")));
  assert.match(calls[1]!.cmd, /ID\]=777 And Integrantes/);
});
