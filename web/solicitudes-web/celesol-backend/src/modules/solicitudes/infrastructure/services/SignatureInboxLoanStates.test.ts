import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LegacySolicitudesUnavailableError } from "../../domain/solicitudes-errors";
import {
  EvaluateListSolicitudesGateway,
  signatureInboxLoanKey,
  type SignatureInboxLoanReference,
} from "./EvaluateListSolicitudesGateway";

type Request = { cmd: string; tipo: string; campos: string; max: number };
const active = (id: string | number) => [id, 1016127, 0, "Normal", 1, "Nuevo", true, 500000];
const cancelled = (id: string | number) => [id, 1016127, 3, "Anulada", 0, "Anulado", false, 0];
const historical = (oid: string | number, loan: unknown[], state: string | null = "Liquidada") => [oid, state, ...loan];
const direct = (id: string | number, state: string | null = null) => [...active(id), state];
const ref = (legacyOid: string, directLoanId = false): SignatureInboxLoanReference => ({ legacyOid, directLoanId });

function fixture(responses: unknown[]) {
  const calls: Request[] = [];
  const gateway = new EvaluateListSolicitudesGateway(
    { baseUrl: "https://core.example.test", timeoutMs: 1000 },
    async (url, init) => {
      assert.match(String(url), /\/api\/Empresa\/EvaluateList$/);
      assert.equal(init?.method, "POST");
      calls.push(JSON.parse(String(init?.body)));
      assert(responses.length, "unexpected upstream query");
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { ok: true, json: async () => response };
    },
  );
  return { gateway, calls };
}

describe("getSignatureInboxLoanStates", () => {
  it("does not query Core for an empty inbox", async () => {
    const f = fixture([]);
    assert.deepEqual(await f.gateway.getSignatureInboxLoanStates([]), new Map());
    assert.equal(f.calls.length, 0);
  });

  it("maps historical and direct loans in batches, including cancellation and explicit paid evidence", async () => {
    const f = fixture([
      [historical(10, active(777)), historical(11, cancelled(888), " Pagada ")],
      [direct(12, "PAGADA")],
    ]);
    const result = await f.gateway.getSignatureInboxLoanStates([ref("10"), ref("11"), ref("12", true)]);
    assert.equal(result.get("request:10")?.lifecycle?.id, "777");
    assert.equal(result.get("request:10")?.transferred, false);
    assert.deepEqual(result.get("request:11"), {
      lifecycle: { id: "888", account: "1016127", estado: 3, estadoLabel: "Anulada", estadoPrestamo: 0, estadoPrestamoLabel: "Anulado", vigente: false, saldo: 0 },
      transferred: true,
    });
    assert.equal(result.get("loan:12")?.transferred, true);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0]?.tipo, "PreSolicitud.Module.Solicitud");
    assert.equal(f.calls[0]?.cmd, "[Oid]=10 Or [Oid]=11");
    assert.match(f.calls[0]!.campos, /ToStr\(\[Prestamo.Estado\]\)/);
    assert.match(f.calls[1]!.campos, /Solicitud.Estado.Descripcion$/);
    assert.equal(f.calls[0]?.max, 3);
  });

  it("keeps the request and loan namespaces separate for colliding IDs", async () => {
    const f = fixture([[historical(777, active(999))], [direct(777, "Pagada")]]);
    const result = await f.gateway.getSignatureInboxLoanStates([ref("777"), ref("777", true)]);
    assert.equal(result.get("request:777")?.lifecycle?.id, "999");
    assert.equal(result.get("request:777")?.transferred, false);
    assert.equal(result.get("loan:777")?.lifecycle?.id, "777");
    assert.equal(result.get("loan:777")?.transferred, true);
  });

  it("never falls back from a present historical request without a loan to a colliding direct ID", async () => {
    const f = fixture([[historical(777, Array(8).fill(null))], [direct(777)]]);
    const result = await f.gateway.getSignatureInboxLoanStates([ref("777"), ref("777", true)]);
    assert.deepEqual(result.get("request:777"), { lifecycle: null, transferred: false });
    assert.equal(result.get("loan:777")?.lifecycle?.id, "777");
    const withoutDirect = fixture([[historical(777, Array(8).fill(null), "Pagada")]]);
    assert.deepEqual((await withoutDirect.gateway.getSignatureInboxLoanStates([ref("777")])).get("request:777"), { lifecycle: null, transferred: true });
    assert.equal(withoutDirect.calls.length, 1);
  });

  it("falls back only for absent historical rows and deduplicates the direct lookup", async () => {
    const f = fixture([[], [direct(777, "Pagada")]]);
    const result = await f.gateway.getSignatureInboxLoanStates([ref("777"), ref("777", true), ref("777")]);
    assert.equal(result.size, 2);
    assert.deepEqual(result.get("request:777"), result.get("loan:777"));
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1]?.cmd, "[ID]=777");
  });

  it("preserves missing loans as unknown, without pretending they are active or transferred", async () => {
    const f = fixture([[], []]);
    assert.deepEqual((await f.gateway.getSignatureInboxLoanStates([ref("777")])).get("request:777"), { lifecycle: null, transferred: false });
  });

  it("normalizes numeric IDs for matching while preserving caller keys and deduplicating reads", async () => {
    const f = fixture([[direct("777")]]);
    const references = [ref("00777", true), ref("777", true), ref("777", true)];
    const result = await f.gateway.getSignatureInboxLoanStates(references);
    assert.equal(result.size, 2);
    assert.equal(result.get(signatureInboxLoanKey(references[0]!))?.lifecycle?.id, "777");
    assert.equal(f.calls[0]?.cmd, "[ID]=777");
  });

  it("caps each query at 120 unique IDs instead of issuing one request per loan", async () => {
    const calls: Request[] = [];
    const gateway = new EvaluateListSolicitudesGateway({ baseUrl: "https://core.example.test", timeoutMs: 1000 }, async (_url, init) => {
      const request: Request = JSON.parse(String(init?.body));
      calls.push(request);
      const ids = [...request.cmd.matchAll(/=([0-9]+)/g)].map(match => match[1]!);
      assert(ids.length <= 120);
      assert.equal(request.max, ids.length + 1);
      return { ok: true, json: async () => ids.map(id => request.tipo.startsWith("PreSolicitud") ? historical(id, active(String(Number(id) + 1000))) : direct(id)) };
    });
    const refs = Array.from({ length: 241 }, (_, i) => ref(String(i + 1)));
    refs.push(...Array.from({ length: 121 }, (_, i) => ref(String(i + 1), true)));
    const result = await gateway.getSignatureInboxLoanStates([...refs, ...refs]);
    assert.equal(result.size, 362);
    assert.equal(calls.length, 5);
    assert.deepEqual(calls.map(call => call.max), [121, 121, 2, 121, 2]);
  });

  it("keeps nullable lifecycle fields unknown and does not coerce null estado to zero", async () => {
    const f = fixture([[[777, null, null, null, null, null, null, null, null]]]);
    const state = (await f.gateway.getSignatureInboxLoanStates([ref("777", true)])).get("loan:777");
    assert.equal(state?.lifecycle?.estado, null);
    assert.equal(state?.lifecycle?.vigente, null);
    assert.equal(state?.transferred, false);
  });

  it("does not infer transfer from cancellation, balance, loan status or unrelated text", async () => {
    const f = fixture([[...[
      [...cancelled(1), null],
      [...active(2).slice(0, 7), 0, "A Transferir"],
      direct(3, "No Pagada"),
      direct(4, "Liquidada"),
    ]]]);
    const result = await f.gateway.getSignatureInboxLoanStates([1, 2, 3, 4].map(id => ref(String(id), true)));
    assert([...result.values()].every(state => state.transferred === false));
  });

  it("rejects invalid input before issuing any network request", async () => {
    for (const id of ["", "1 Or 1=1", "-1", "1.5", "x"]) {
      const f = fixture([]);
      await assert.rejects(f.gateway.getSignatureInboxLoanStates([ref(id)]), LegacySolicitudesUnavailableError);
      assert.equal(f.calls.length, 0);
    }
  });

  it("propagates unavailable HTTP, network and JSON reads as 503", async () => {
    const unavailable = new EvaluateListSolicitudesGateway({ baseUrl: "https://core.example.test", timeoutMs: 1000 }, async () => ({ ok: false, json: async () => [] }));
    await assert.rejects(unavailable.getSignatureInboxLoanStates([ref("1", true)]), error => error instanceof LegacySolicitudesUnavailableError && error.statusCode === 503);
    const f = fixture([new Error("timeout")]);
    await assert.rejects(f.gateway.getSignatureInboxLoanStates([ref("1", true)]), LegacySolicitudesUnavailableError);
    const invalidJson = new EvaluateListSolicitudesGateway({ baseUrl: "https://core.example.test", timeoutMs: 1000 }, async () => ({ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } }));
    await assert.rejects(invalidJson.getSignatureInboxLoanStates([ref("1", true)]), LegacySolicitudesUnavailableError);
  });

  it("rejects malformed, unrelated and duplicate direct rows instead of returning partial results", async () => {
    for (const body of [
      {}, [null], ["not a row"], [[1]], [direct(2)], [direct(1), direct(1)],
      [[...active(1).slice(0, 8), 123]],
      [[1, 1016127, false, "Normal", 1, "Nuevo", true, 0, null]],
      [[1, 1016127, "unknown", "Normal", 1, "Nuevo", true, 0, null]],
      [[1, 1016127, 0, "Normal", 1, "Nuevo", "unknown", 0, null]],
      [[1, 1016127, 0, "Normal", 1, "Nuevo", true, Infinity, null]],
      [[Number.MAX_SAFE_INTEGER + 1, 1016127, 0, "Normal", 1, "Nuevo", true, 0, null]],
    ]) {
      await assert.rejects(fixture([body]).gateway.getSignatureInboxLoanStates([ref("1", true)]), LegacySolicitudesUnavailableError);
    }
  });

  it("rejects duplicate or inconsistent historical rows and never hides them through fallback", async () => {
    for (const body of [
      [historical(1, active(777)), historical(1, active(888))],
      [historical(2, active(777))],
      [historical(1, [null, 1016127, 0, "Normal", 1, "Nuevo", true, 0])],
      [[1, "Liquidada"]],
    ]) {
      const f = fixture([body]);
      await assert.rejects(f.gateway.getSignatureInboxLoanStates([ref("1")]), LegacySolicitudesUnavailableError);
      assert.equal(f.calls.length, 1);
    }
  });

  it("fails the whole read if a later batch fails", async () => {
    const firstBatch = Array.from({ length: 120 }, (_, i) => direct(i + 1));
    const f = fixture([firstBatch, new Error("upstream unavailable")]);
    await assert.rejects(f.gateway.getSignatureInboxLoanStates(Array.from({ length: 121 }, (_, i) => ref(String(i + 1), true))), LegacySolicitudesUnavailableError);
    assert.equal(f.calls.length, 2);
  });
});
