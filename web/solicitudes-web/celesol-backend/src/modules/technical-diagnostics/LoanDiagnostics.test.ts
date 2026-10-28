import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createLoanDiagnosticWriter,
  redactDiagnosticText,
  sanitizeLoanDiagnostic,
  type LoanDiagnosticContext,
} from "./LoanDiagnostics";

const REDACTED = "[REDACTED]";
const context = (): LoanDiagnosticContext => ({
  operationId: randomUUID(), solicitudId: randomUUID(), actorId: randomUUID(),
  realActorId: randomUUID(), operation: "loan_generation",
});
const fakeDb = (create: (input: unknown) => Promise<unknown>) => ({
  technicalDiagnosticEvent: { create },
}) as unknown as Pick<PrismaClient, "technicalDiagnosticEvent">;
const record = (value: unknown) => value as Record<string, unknown>;

it("sanitizes nested credential values and raw JSON without changing financial data, wire order, or input", () => {
  const wire = JSON.stringify({ campos: {
    LineaPrestamo: "88", Cuotas: 36, MontoDeseado: 6000000,
  }, password: "raw password with spaces", client_secret: "raw client secret" });
  const source = Object.freeze({
    requestBody: wire,
    headers: Object.freeze({ Authorization: "Basic syntheticCredential", "Set-Cookie": "sid=private; other=private2" }),
    nested: Object.freeze([
      Object.freeze({ access_token: "nested-token", business: "unchanged" }),
      Object.freeze({ apiKey: "synthetic-api-key", amount: 6000000 }),
    ]),
    url: "https://synthetic-user:synthetic-password@example.test/action?token=query-secret&amount=6000000",
    privateKey: "-----BEGIN PRIVATE KEY-----\nsynthetic-private-material\n-----END PRIVATE KEY-----",
    business: Object.freeze({ dni: "12345678", installment: 36, amount: 6000000 }),
  });
  const before = JSON.stringify(source);
  const result = record(sanitizeLoanDiagnostic(source));
  const text = JSON.stringify(result);
  for (const secret of [
    "raw password with spaces", "raw client secret", "syntheticCredential", "sid=private",
    "other=private2", "nested-token", "synthetic-api-key", "synthetic-user",
    "synthetic-password", "query-secret", "synthetic-private-material",
  ]) assert(!text.includes(secret), `credential leaked: ${secret}`);
  assert.deepEqual(result.business, source.business);
  assert.deepEqual(JSON.parse(String(result.requestBody)).campos, { LineaPrestamo: "88", Cuotas: 36, MontoDeseado: 6000000 });
  assert(String(result.requestBody).indexOf("LineaPrestamo") < String(result.requestBody).indexOf("Cuotas"));
  assert.equal(JSON.stringify(source), before);
  assert.equal(source.requestBody, wire);
});

it("redacts complete Basic/Bearer headers, cookies, and unquoted secrets with spaces in diagnostic text", () => {
  const raw = [
    "Authorization: Basic synthetic-basic-credential",
    "Proxy-Authorization: Bearer synthetic-proxy-token",
    "Cookie: sid=synthetic-session; refresh=synthetic-refresh; preference=synthetic-private-preference",
    "Set-Cookie: sid=synthetic-cookie; Path=/; HttpOnly",
    "password=synthetic-password synthetic-password-tail",
    "Client-Secret: synthetic-client-secret synthetic-client-secret-tail",
    "https://example.test/path?api_key=synthetic-query-key&business=kept",
    "business-marker-preserved",
  ].join("\n");
  const sanitized = redactDiagnosticText(raw);
  for (const secret of [
    "synthetic-basic-credential", "synthetic-proxy-token", "synthetic-session",
    "synthetic-refresh", "synthetic-private-preference", "synthetic-cookie",
    "synthetic-password", "synthetic-password-tail", "synthetic-client-secret", "synthetic-client-secret-tail",
    "synthetic-query-key",
  ]) assert(!sanitized.includes(secret), `credential leaked: ${secret}`);
  assert(sanitized.includes("business-marker-preserved"));
  assert(sanitized.includes("business=kept"));
  assert(sanitized.includes(REDACTED));
});

it("retains original Error name, cause, code and stack while sanitizing embedded credentials", () => {
  const cause = Object.assign(new Error("socket failure at https://user:password@example.test/private"), { code: "ECONNRESET" });
  const error = new TypeError("Vimarx request failed: token=synthetic-error-token", { cause });
  Object.defineProperty(error, "code", { value: "VIMARX_HTTP_FAILURE", enumerable: false });
  const before = { message: error.message, stack: error.stack, cause };
  const result = record(sanitizeLoanDiagnostic(error));
  assert.equal(result.name, "TypeError");
  assert.equal(result.code, "VIMARX_HTTP_FAILURE");
  assert.equal(record(result.cause).code, "ECONNRESET");
  assert.equal(record(result.cause).name, "Error");
  assert(String(result.stack).includes("Vimarx request failed"));
  assert(!JSON.stringify(result).includes("synthetic-error-token"));
  assert(!JSON.stringify(result).includes("user:password"));
  assert.equal(error.message, before.message);
  assert.equal(error.stack, before.stack);
  assert.equal(error.cause, before.cause);
});

it("redacts credentials in JSON encoded inside upstream errors, including an Error message prefix", () => {
  const embedded = JSON.stringify({ password: "synthetic-embedded-password", amount: 500000 });
  const response = JSON.stringify({ Error: embedded, ID: "443444" });
  const prefixed = new Error(`Vimarx rejected the request: ${response}`);
  const sanitized = redactDiagnosticText(response);
  const error = record(sanitizeLoanDiagnostic(prefixed));
  assert(!sanitized.includes("synthetic-embedded-password"));
  assert(!JSON.stringify(error).includes("synthetic-embedded-password"));
  assert(sanitized.includes("500000"));
  assert(sanitized.includes("443444"));
  assert(String(error.message).includes("Vimarx rejected the request:"));
  assert(sanitized.includes(REDACTED));
  assert.equal(prefixed.message, `Vimarx rejected the request: ${response}`);
});

it("redacts prefixed credential names in structured data and raw diagnostic text", () => {
  const source = {
    DB_PASSWORD: "synthetic-prefixed-db-password",
    "X-Api-Key": "synthetic-prefixed-api-key",
    amount: 500000,
  };
  const result = record(sanitizeLoanDiagnostic(source));
  assert.equal(result.DB_PASSWORD, REDACTED);
  assert.equal(result["X-Api-Key"], REDACTED);
  assert.equal(result.amount, 500000);
  const raw = "DB_PASSWORD=synthetic-prefixed-db-password\nX-Api-Key: synthetic-prefixed-api-key\namount=500000";
  const sanitized = redactDiagnosticText(raw);
  assert(!sanitized.includes("synthetic-prefixed-db-password"));
  assert(!sanitized.includes("synthetic-prefixed-api-key"));
  assert(sanitized.includes("amount=500000"));
});

it("redacts the value of a password input in an upstream HTML response", () => {
  const html = '<form><input name="password" value="synthetic-html-password"><p>Core error 500</p></form>';
  const sanitized = redactDiagnosticText(html);
  assert(!sanitized.includes("synthetic-html-password"));
  assert(sanitized.includes("Core error 500"));
  assert(sanitized.includes(REDACTED));
});

it("sanitizes a complete large body with a credential URL at the end without quadratic scanning", { timeout: 3000 }, () => {
  const body = "complete-response-".repeat(20000);
  const raw = `${body}\nhttps://synthetic-user:synthetic-url-password@example.test/action\nEND-OF-COMPLETE-RESPONSE`;
  const start = performance.now();
  const sanitized = redactDiagnosticText(raw);
  assert(performance.now() - start < 1500, "large responses must not block the backend event loop");
  assert(sanitized.startsWith(body));
  assert(sanitized.endsWith("END-OF-COMPLETE-RESPONSE"));
  assert(sanitized.includes(`https://${REDACTED}@example.test/action`));
  assert(!sanitized.includes("synthetic-user"));
  assert(!sanitized.includes("synthetic-url-password"));
});

it("retains complete long payloads and represents cycles without losing shared subtrees", () => {
  const body = `${"financial-payload-".repeat(20000)}END-OF-COMPLETE-RESPONSE`;
  const shared = { amount: 12345, body };
  const cyclic: Record<string, unknown> = { first: shared, second: shared };
  cyclic.self = cyclic;
  const result = record(sanitizeLoanDiagnostic(cyclic));
  assert.deepEqual(result.first, result.second);
  assert.equal(record(result.first).body, body);
  assert.equal(result.self, "[CIRCULAR]");
  assert.equal(record(result.first).amount, 12345);
});

it("persists sanitized snapshots with operation and HTTP correlation before the next side effect", async () => {
  const order: string[] = [];
  let saved: unknown;
  const writer = createLoanDiagnosticWriter(fakeDb(async input => {
    order.push("persist-request"); saved = input; return {};
  }));
  const op = context(), callId = randomUUID();
  const event = { stage: "HTTP_REQUEST", callId, data: { body: { amount: 500000, password: "private-password" } } };
  await writer(op, event, true);
  order.push("http-side-effect");
  assert.deepEqual(order, ["persist-request", "http-side-effect"]);
  const row = record(record(saved).data);
  assert.equal(row.operationId, op.operationId);
  assert.equal(row.solicitudId, op.solicitudId);
  assert.equal(row.callId, callId);
  assert.equal(record(record(row.data).body).password, REDACTED);
  assert.equal(record(record(row.data).body).amount, 500000);
  assert.equal(event.data.body.password, "private-password");
});

it("required storage failure stops before HTTP and emits a sanitized fallback", async () => {
  const fallbacks: unknown[] = [];
  let httpCalls = 0;
  const writer = createLoanDiagnosticWriter(fakeDb(async () => {
    throw new Error("postgresql://synthetic-db-user:synthetic-db-password@localhost/test");
  }), { fallback: event => fallbacks.push(event) });
  await assert.rejects(async () => {
    await writer(context(), { stage: "HTTP_REQUEST", data: { token: "synthetic-event-token" } }, true);
    httpCalls++;
  }, /antes de contactar Vimarx/);
  assert.equal(httpCalls, 0);
  assert.equal(fallbacks.length, 1);
  const text = JSON.stringify(fallbacks);
  assert(!text.includes("synthetic-db-user"));
  assert(!text.includes("synthetic-db-password"));
  assert(!text.includes("synthetic-event-token"));
});

it("response logging failure preserves a confirmed loan ID and the complete sanitized fallback", async () => {
  const fallbacks: unknown[] = [];
  const completeBody = JSON.stringify({ Ok: true, ID: "443444", detail: "response detail ".repeat(20000), token: "synthetic-response-token" });
  const writer = createLoanDiagnosticWriter(fakeDb(async () => { throw new Error("password=synthetic-database-password"); }), {
    fallback: event => fallbacks.push(event),
  });
  const knownRemoteResult = async () => {
    const result = { id: "443444" };
    await writer(context(), { stage: "HTTP_RESPONSE", elapsedMs: 123, data: { status: 200, body: completeBody } });
    return result;
  };
  assert.deepEqual(await knownRemoteResult(), { id: "443444" });
  assert.equal(fallbacks.length, 1);
  const event = record(fallbacks[0]);
  assert.equal(event.elapsedMs, 123);
  const payload = JSON.parse(String(record(event.data).body));
  assert.equal(payload.ID, "443444");
  assert.equal(payload.detail, "response detail ".repeat(20000));
  assert.equal(payload.token, REDACTED);
  assert(!JSON.stringify(event).includes("synthetic-database-password"));
});

it("a failed fallback collector cannot turn optional diagnostics into a business failure", async () => {
  const writer = createLoanDiagnosticWriter(fakeDb(async () => { throw new Error("storage down"); }), {
    fallback: () => { throw new Error("collector down"); },
  });
  await assert.doesNotReject(writer(context(), { stage: "REMOTE_CREATED", data: { id: "443444" } }));
  await assert.rejects(writer(context(), { stage: "HTTP_REQUEST", data: {} }, true), /antes de contactar Vimarx/);
});

it("bounds optional and required writes even when the storage promise never settles", { timeout: 2000 }, async () => {
  const fallbacks: unknown[] = [];
  const writer = createLoanDiagnosticWriter(fakeDb(() => new Promise(() => undefined)), {
    timeoutMs: 15, fallback: event => fallbacks.push(event),
  });
  const start = performance.now();
  await writer(context(), { stage: "HTTP_RESPONSE", data: { ID: "443444" } });
  await assert.rejects(writer(context(), { stage: "HTTP_REQUEST", data: {} }, true), /antes de contactar Vimarx/);
  assert(performance.now() - start < 1500);
  assert.equal(fallbacks.length, 2);
  for (const event of fallbacks) assert(String(record(record(event).storageError).message).includes("timeout"));
});
