import assert from "node:assert/strict";
import { it } from "node:test";
import { EvaluateListSolicitudesGateway } from "./EvaluateListSolicitudesGateway";

it("Core reconciliation uses read-only queries, resolves historical IDs and verifies the associated socio", async () => {
  const calls: { tipo: string; cmd: string }[] = [];
  const responses = [[[90]], [777, 600000, 12, 55, "2026-11-01", 0], [777, 600000, 12, 55, "2026-11-01", 0]];
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
  const responses = [[[90]], [777, 600000, 12, 55, "2026-11-01", 0], []];
  let calls = 0;
  const gateway = new EvaluateListSolicitudesGateway({ baseUrl: "https://example.test", timeoutMs: 1000 }, async () => {
    calls++;
    return { ok: true, json: async () => responses.shift() };
  });
  assert.equal(await gateway.getCoreReconciliationSnapshot("123", "12345678"), null);
  assert.equal(calls, 3);
});
