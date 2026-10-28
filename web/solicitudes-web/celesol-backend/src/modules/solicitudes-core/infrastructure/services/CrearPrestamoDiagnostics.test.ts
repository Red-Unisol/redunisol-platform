import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LoanDiagnosticContext, LoanDiagnosticWriter } from "../../../technical-diagnostics/LoanDiagnostics";
import { PrestamoLegacyRechazadoError, PrestamoLegacyUnavailableError } from "../../domain/solicitudes-core-errors";
import { CrearPrestamoGateway, type CrearPrestamoInput } from "./CrearPrestamoGateway";

type Event = Parameters<LoanDiagnosticWriter>[1];
type SavedEvent = { context: LoanDiagnosticContext; event: Event; required?: boolean };
type Fetcher = NonNullable<ConstructorParameters<typeof CrearPrestamoGateway>[1]>;
const input: CrearPrestamoInput = {
  cuotas: 12, fechaEmision: "2026-10-27", integrantes: [{ socio: "1234", tipoRelacion: "Titular" }],
  lineaPrestamo: "88", montoDeseado: 500000, vendedor: "351", nroLote: 1200000,
};
const context: LoanDiagnosticContext = {
  operationId: "operation-1", solicitudId: "solicitud-1", actorId: "actor-1", realActorId: "real-actor-1", operation: "loan_generation",
};
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function fixture(fetcher: Fetcher, options: { writer?: LoanDiagnosticWriter; timeoutMs?: number } = {}) {
  const events: SavedEvent[] = [];
  let calls = 0;
  const diagnostics: LoanDiagnosticWriter = async (ctx, event, required) => {
    events.push({ context: ctx, event, required });
    await options.writer?.(ctx, event, required);
  };
  const gateway = new CrearPrestamoGateway({
    baseUrl: "https://legacy.example.test", timeoutMs: options.timeoutMs ?? 1000, diagnostics,
  }, async (...args) => { calls++; return fetcher(...args); });
  const data = (stage: string) => events.find(saved => saved.event.stage === stage)?.event.data as Record<string, unknown>;
  const failures = () => events.filter(saved => saved.event.stage === "FAILURE").map(saved => saved.event.data as Record<string, unknown>);
  return { gateway, events, data, failures, calls: () => calls };
}

function assertGeneric(error: unknown) {
  assert(error instanceof PrestamoLegacyUnavailableError || error instanceof PrestamoLegacyRechazadoError);
  assert.doesNotMatch(error.message, /SECRET|SQL|ECONNREFUSED|<html>|credentials/i);
  assert.equal(error.cause, undefined);
  return true;
}

describe("CrearPrestamoGateway diagnostics", () => {
  it("durably records the exact ordered request before fetch and preserves the complete raw response", async () => {
    const raw = ' { "Ok": true, "ID": 443444, "Error": null }\n';
    let sentBody = "";
    const f = fixture(async (_url, init) => {
      assert.equal(f.events.length, 1);
      assert.equal(f.events[0]?.event.stage, "REQUEST");
      assert.equal(f.events[0]?.required, true);
      sentBody = String(init?.body);
      return new Response(raw, { status: 200, statusText: "OK", headers: { "Content-Type": "application/json", "X-Core-Trace": "trace-1", "Set-Cookie": "session=SECRET" } });
    });
    assert.deepEqual(await f.gateway.crear(input, context), { id: "443444" });
    assert.equal(f.calls(), 1);
    assert.deepEqual(f.events.map(saved => saved.event.stage), ["REQUEST", "RESPONSE", "SUCCESS"]);
    assert(f.events.every(saved => saved.context === context));
    const callId = f.events[0]!.event.callId!;
    assert.match(callId, uuid);
    assert(f.events.every(saved => saved.event.callId === callId));
    assert(f.events.every(saved => typeof saved.event.elapsedMs === "number" && saved.event.elapsedMs >= 0));
    assert.deepEqual(f.data("REQUEST"), {
      endpointPath: "/api/Simulador/CrearPrestamo", url: "https://legacy.example.test/api/Simulador/CrearPrestamo",
      method: "POST", headers: { "Content-Type": "application/json" }, body: sentBody,
    });
    assert.equal(sentBody, '{"campos":{"FechaEmision":"2026-10-27","Integrantes":[{"Socio":"1234","TipoRelacion":"Titular"}],"NroLote":1200000,"LineaPrestamo":"88","Cuotas":12,"MontoDeseado":500000,"Vendedor":"351"},"validar":false}');
    assert.deepEqual(f.data("RESPONSE"), {
      endpointPath: "/api/Simulador/CrearPrestamo", status: 200, statusText: "OK",
      headers: { "content-type": "application/json", "x-core-trace": "trace-1", "set-cookie": "[REDACTED]" },
      body: raw, bodyFormat: "text",
    });
    assert.equal(f.data("SUCCESS").loanId, "443444");
  });

  it("generates a correlated operation context when the caller does not provide one", async () => {
    const f = fixture(async () => new Response('{"Ok":true,"ID":"42"}'));
    await f.gateway.crear(input);
    const generated = f.events[0]!.context;
    assert.equal(generated.operation, "loan_generation");
    assert.match(generated.operationId, uuid);
    assert.equal(generated.solicitudId, undefined);
    assert(f.events.every(saved => saved.context === generated));
  });

  it("supports existing json-only injected responses without fetching or parsing twice", async () => {
    let parses = 0;
    const f = fixture(async () => ({ ok: true, json: async () => { parses++; return { Ok: true, ID: 42 }; } }));
    assert.deepEqual(await f.gateway.crear(input, context), { id: "42" });
    assert.equal(parses, 1);
    assert.equal(f.data("RESPONSE").body, '{"Ok":true,"ID":42}');
    assert.equal(f.data("RESPONSE").bodyFormat, "json-fallback");
  });

  it("stores explicit rejection details and raw body without exposing them in the public error", async () => {
    const detail = "SQL SECRET\nValidation failed at Core.Service.Generate()";
    const raw = JSON.stringify({ Ok: false, ID: null, Error: detail });
    const f = fixture(async () => new Response(raw));
    await assert.rejects(f.gateway.crear(input, context), error => {
      assert(error instanceof PrestamoLegacyRechazadoError);
      assert.equal(error.statusCode, 422);
      return assertGeneric(error);
    });
    assert.equal(f.failures()[0]?.classification, "rejection");
    assert.equal((f.failures()[0]?.error as Error).message, detail);
    assert.equal(f.data("RESPONSE").body, raw);
    assert.equal(f.calls(), 1);
  });

  it("records an HTTP 500 body and status as http_error without retrying", async () => {
    const raw = '<html>SQL SECRET stack from upstream</html>';
    const f = fixture(async () => new Response(raw, { status: 500, statusText: "Internal Server Error", headers: { "X-Core-Trace": "trace-500" } }));
    await assert.rejects(f.gateway.crear(input, context), assertGeneric);
    assert.equal(f.data("RESPONSE").status, 500);
    assert.equal(f.data("RESPONSE").statusText, "Internal Server Error");
    assert.equal(f.data("RESPONSE").body, raw);
    assert.deepEqual(f.failures().map(event => event.classification), ["http_error"]);
    assert.equal(f.calls(), 1);
  });

  it("preserves a confirmed loan ID even if Core uses a failing HTTP status", async () => {
    const f = fixture(async () => new Response('{"Ok":true,"ID":443444}', { status: 500, statusText: "Internal Server Error" }));
    assert.deepEqual(await f.gateway.crear(input, context), { id: "443444" });
    assert.deepEqual(f.failures().map(event => event.classification), ["http_error"]);
    assert.equal(f.data("SUCCESS").loanId, "443444");
    assert.equal(f.data("SUCCESS").httpStatusOk, false);
    assert.equal(f.calls(), 1);
  });

  it("classifies invalid JSON while retaining its exact raw HTML or malformed text", async () => {
    for (const raw of ["<html>SECRET</html>", '{"Ok":true,', ""]) {
      const f = fixture(async () => new Response(raw));
      await assert.rejects(f.gateway.crear(input, context), assertGeneric);
      assert.equal(f.data("RESPONSE").body, raw);
      assert.equal(f.failures()[0]?.classification, "invalid_json");
      assert(f.failures()[0]?.error instanceof SyntaxError);
      assert.equal(f.calls(), 1);
    }
  });

  it("classifies malformed success shapes and invalid IDs without inventing a successful loan", async () => {
    for (const body of [null, [], true, {}, { Ok: "true", ID: 42 }, { Ok: true }, ...[null, false, "0", "-1", "42.5", 42.5, Number.MAX_SAFE_INTEGER + 1].map(ID => ({ Ok: true, ID }))]) {
      const f = fixture(async () => new Response(JSON.stringify(body)));
      await assert.rejects(f.gateway.crear(input, context), assertGeneric);
      assert.equal(f.failures()[0]?.classification, "invalid_response");
      assert.equal(f.events.some(saved => saved.event.stage === "SUCCESS"), false);
      assert.equal(f.calls(), 1);
    }
  });

  it("preserves the original network error and its nested cause only in diagnostics", async () => {
    const cause = Object.assign(new Error("ECONNREFUSED SECRET"), { code: "ECONNREFUSED" });
    const original = new TypeError("fetch failed", { cause });
    const f = fixture(async () => { throw original; });
    await assert.rejects(f.gateway.crear(input, context), assertGeneric);
    assert.deepEqual(f.events.map(saved => saved.event.stage), ["REQUEST", "FAILURE"]);
    assert.equal(f.failures()[0]?.classification, "network_error");
    assert.equal(f.failures()[0]?.error, original);
    assert.equal((f.failures()[0]?.error as Error).cause, cause);
    assert.equal(f.calls(), 1);
  });

  it("enforces the deadline while awaiting response headers", async () => {
    let signal: AbortSignal | undefined;
    const f = fixture(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    }, { timeoutMs: 15 });
    await assert.rejects(f.gateway.crear(input, context), assertGeneric);
    assert.equal(signal?.aborted, true);
    assert.equal(f.failures()[0]?.classification, "timeout");
    assert.equal(f.calls(), 1);
  });

  it("keeps the timeout active after headers, even when the body does not settle on abort", async () => {
    let signal: AbortSignal | undefined;
    const f = fixture(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return {
        ok: true, status: 200, statusText: "OK", json: async () => assert.fail("text is available"),
        text: async () => new Promise<string>(() => undefined),
      };
    }, { timeoutMs: 15 });
    await assert.rejects(f.gateway.crear(input, context), assertGeneric);
    assert.equal(signal?.aborted, true);
    assert.equal(f.failures()[0]?.classification, "timeout");
    assert.equal(f.data("RESPONSE").status, 200);
    assert.equal(f.data("RESPONSE").body, null);
    assert(f.data("RESPONSE").bodyReadError instanceof Error);
    assert.equal(f.calls(), 1);
  });

  it("classifies interrupted text reads as a network failure and retains their cause", async () => {
    const cause = new Error("connection reset SECRET");
    const f = fixture(async () => ({ ok: true, status: 200, json: async () => null, text: async () => { throw cause; } }));
    await assert.rejects(f.gateway.crear(input, context), assertGeneric);
    assert.equal(f.failures()[0]?.classification, "network_error");
    assert.equal(f.failures()[0]?.error, cause);
    assert.equal(f.data("RESPONSE").bodyReadError, cause);
  });

  it("does not call Core when the required request trace fails", async () => {
    const f = fixture(async () => assert.fail("Core must not be called without a request trace"), {
      writer: async (_ctx, event) => { if (event.stage === "REQUEST") throw new Error("SECRET database unavailable"); },
    });
    await assert.rejects(f.gateway.crear(input, context), assertGeneric);
    assert.equal(f.calls(), 0);
    assert.deepEqual(f.events.map(saved => saved.event.stage), ["REQUEST"]);
  });

  it("does not lose a confirmed ID when optional response and success diagnostics fail", async () => {
    const f = fixture(async () => new Response('{"Ok":true,"ID":443444}'), {
      writer: async (_ctx, event, required) => { if (!required) throw new Error(`SECRET failed ${event.stage}`); },
    });
    assert.deepEqual(await f.gateway.crear(input, context), { id: "443444" });
    assert.equal(f.calls(), 1);
    assert.deepEqual(f.events.map(saved => saved.event.stage), ["REQUEST", "RESPONSE", "SUCCESS"]);
  });

  it("does not replace the public failure or retry when optional failure logging fails", async () => {
    const f = fixture(async () => { throw new TypeError("fetch failed SECRET"); }, {
      writer: async (_ctx, _event, required) => { if (!required) throw new Error("SECRET logging failed"); },
    });
    await assert.rejects(f.gateway.crear(input, context), assertGeneric);
    assert.equal(f.calls(), 1);
    assert.equal(f.failures()[0]?.classification, "network_error");
  });
});
