import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { createWorker, DELIVERY_URL, MAX_RAW_BYTES, SOURCE_HOST, SOURCE_PATH } from "../src/worker.js";

const SECRET = "fixture-webhook-secret-not-an-operational-credential";
const TOKEN = "fixture-delivery-token-not-an-operational-credential";
const SOURCE_URL = "https://" + SOURCE_HOST + SOURCE_PATH;
const bytes = new TextEncoder().encode('{"eventName":"fixture","raw":"test"}\r\n');

async function signature(body = bytes, secret = SECRET) {
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await webcrypto.subtle.sign("HMAC", key, body)).toString("hex");
}

async function request({ url = SOURCE_URL, method = "POST", body = bytes, headers = {} } = {}) {
  return new Request(url, { method, headers: { "content-type": "application/json", "x-signature": await signature(body), ...headers },
    ...(method === "GET" ? {} : { body, duplex: "half" }) });
}

function context() {
  const promises = [];
  return { promises, waitUntil(promise) { promises.push(promise); }, async finish() { await Promise.all(promises); } };
}

function environment(send = async () => {}) {
  return { SHADOW_CAPTURE_ENABLED: "true", METAMAP_WEBHOOK_SECRET: SECRET,
    SHADOW_DELIVERY_TOKEN: TOKEN, SHADOW_QUEUE: { send } };
}

function worker(options = {}) {
  return createWorker({ cryptoImpl: webcrypto, log: () => {}, ...options });
}

async function envelope() {
  return { version: 1, delivery_id: "9a1b8510-a278-4a46-a487-c3963a78a954",
    body_base64: Buffer.from(bytes).toString("base64"),
    body_sha256: Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex"),
    signature: await signature(), content_type: "application/json", received_at: "2026-11-13T12:34:56.000Z", primary_status: 200 };
}

function acknowledgement(body, extra = {}) {
  return { delivery_id: body.delivery_id, body_sha256: body.body_sha256,
    ingest_status: 200, duplicate: false, shadow_only: true, ...extra };
}

function message(body, attempts = 1) {
  const result = { body, attempts, acknowledgements: 0, retries: [],
    ack() { this.acknowledgements += 1; }, retry(options) { this.retries.push(options); } };
  return result;
}

test("primary keeps original URL, bytes, headers, response status and headers; copy preserves raw bytes", async () => {
  const raw = Uint8Array.from([...bytes, 0, 255, 128]);
  const original = await request({ url: SOURCE_URL + "?private=never-copy-this", body: raw,
    headers: { "x-custom-primary": "preserved", "authorization": "primary-only" } });
  const response = new Response(Uint8Array.from([0, 255, 42]), { status: 418, headers: { "X-Primary": "original" } });
  const copies = [];
  const events = [];
  const instance = worker({ fetchImpl: async (actual) => {
    events.push("primary");
    assert.equal(actual, original);
    assert.equal(actual.url, SOURCE_URL + "?private=never-copy-this");
    assert.equal(actual.headers.get("authorization"), "primary-only");
    assert.equal(actual.headers.get("x-custom-primary"), "preserved");
    assert.deepEqual(new Uint8Array(await actual.arrayBuffer()), raw);
    return response;
  } });
  const ctx = context();
  const result = await instance.fetch(original, environment(async (copy, options) => {
    events.push("queue"); copies.push(copy); assert.deepEqual(options, { contentType: "json" });
  }), ctx);
  assert.equal(result, response);
  assert.equal(result.status, 418);
  assert.equal(result.headers.get("x-primary"), "original");
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), Uint8Array.from([0, 255, 42]));
  await ctx.finish();
  assert.deepEqual(events, ["primary", "queue"]);
  assert.equal(copies.length, 1);
  assert.deepEqual(Buffer.from(copies[0].body_base64, "base64"), Buffer.from(raw));
  assert.equal(copies[0].primary_status, 418);
  assert.equal(copies[0].signature, await signature(raw));
  assert.match(copies[0].delivery_id, /^[0-9a-f-]{36}$/);
  assert.equal(copies[0].body_sha256, Buffer.from(await webcrypto.subtle.digest("SHA-256", raw)).toString("hex"));
  assert.equal(copies[0].content_type, "application/json");
  assert.equal(JSON.stringify(copies[0]).includes("never-copy-this"), false);
  assert.deepEqual(Object.keys(copies[0]).sort(), ["body_base64", "body_sha256", "content_type", "delivery_id",
    "primary_status", "received_at", "signature", "version"]);
});

test("a queue that has not resolved cannot delay the primary response", async () => {
  let release;
  const queuePending = new Promise((resolve) => { release = resolve; });
  const ctx = context();
  const instance = worker({ fetchImpl: async (actual) => { await actual.arrayBuffer(); return new Response("primary"); } });
  try {
    const result = await Promise.race([
      instance.fetch(await request(), environment(() => queuePending), ctx),
      new Promise((unused, reject) => setTimeout(() => reject(new Error("primary was blocked")), 100)),
    ]);
    assert.equal(await result.text(), "primary");
  } finally { release(); await ctx.finish(); }
});

test("invalid signature, absent secret or queue and malformed metadata omit only the copy", async () => {
  for (const variant of ["invalid-signature", "no-secret", "no-queue", "long-content-type"]) {
    let sent = 0;
    const env = environment(async () => { sent += 1; });
    if (variant === "no-secret") delete env.METAMAP_WEBHOOK_SECRET;
    if (variant === "no-queue") delete env.SHADOW_QUEUE;
    const original = await request({ headers: variant === "invalid-signature" ? { "x-signature": "0".repeat(64) } :
      variant === "long-content-type" ? { "content-type": "x".repeat(257) } : {} });
    const ctx = context();
    const result = await worker({ fetchImpl: async (actual) => { await actual.arrayBuffer(); return new Response("unchanged", { status: 202 }); } })
      .fetch(original, env, ctx);
    await ctx.finish();
    assert.equal(result.status, 202); assert.equal(await result.text(), "unchanged"); assert.equal(sent, 0, variant);
  }
});

test("a signed request without Content-Type is copied with empty metadata and no added primary header", async () => {
  const original = new Request(SOURCE_URL, { method: "POST", body: bytes,
    headers: { "x-signature": await signature() } });
  const copies = [];
  const ctx = context();
  const result = await worker({ fetchImpl: async (actual) => {
    assert.equal(actual, original); assert.equal(actual.headers.has("content-type"), false);
    assert.deepEqual(new Uint8Array(await actual.arrayBuffer()), bytes);
    return new Response("primary", { status: 202 });
  } }).fetch(original, environment(async (copy) => copies.push(copy)), ctx);
  await ctx.finish();
  assert.equal(result.status, 202); assert.equal(await result.text(), "primary");
  assert.equal(copies.length, 1); assert.equal(copies[0].content_type, "");
  const queued = message(copies[0]);
  await worker({ fetchImpl: async () => Response.json(acknowledgement(copies[0])) })
    .queue({ messages: [queued] }, environment());
  assert.equal(queued.acknowledgements, 1);
});

test("non-ASCII Content-Type omits only the copy and preserves the primary bytes and header", async () => {
  const contentType = "application/json; fixture=\u00e9";
  const original = await request({ headers: { "content-type": contentType } });
  let copies = 0;
  const ctx = context();
  const response = new Response("unchanged", { status: 201, headers: { "X-Primary": "retained" } });
  const result = await worker({ fetchImpl: async (actual) => {
    assert.equal(actual, original); assert.equal(actual.headers.get("content-type"), contentType);
    assert.deepEqual(new Uint8Array(await actual.arrayBuffer()), bytes); return response;
  } }).fetch(original, environment(async () => { copies += 1; }), ctx);
  await ctx.finish();
  assert.equal(result, response); assert.equal(result.status, 201);
  assert.equal(result.headers.get("x-primary"), "retained"); assert.equal(await result.text(), "unchanged");
  assert.equal(copies, 0);
});

test("failed queue and logging exceptions never modify the primary response or leak details", async () => {
  const logs = [];
  const ctx = context();
  const instance = worker({ fetchImpl: async (actual) => { await actual.arrayBuffer(); return new Response("origin", { status: 503 }); },
    log(record) { logs.push(record); throw new Error("logging unavailable"); } });
  const result = await instance.fetch(await request(), environment(async () => { throw new Error(SECRET + TOKEN + " raw-body"); }), ctx);
  await ctx.finish();
  assert.equal(result.status, 503); assert.equal(await result.text(), "origin");
  const text = JSON.stringify(logs);
  assert.equal(text.includes(SECRET), false); assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes("raw-body"), false); assert.match(text, /queue_send_failed/);
});

test("primary network failure is preserved without replay; a signed copy records null status", async () => {
  const failure = new Error("primary fixture unavailable");
  const copies = [];
  let primaryCalls = 0;
  const ctx = context();
  const instance = worker({ fetchImpl: async (actual) => {
    primaryCalls += 1; await actual.arrayBuffer(); throw failure;
  } });
  await assert.rejects(instance.fetch(await request(), environment(async (copy) => copies.push(copy)), ctx),
    (error) => error === failure);
  await ctx.finish();
  assert.equal(primaryCalls, 1); assert.equal(copies.length, 1); assert.equal(copies[0].primary_status, null);
});

test("nonmatching hostname, path, trailing slash, method or disabled capture is pure pass-through", async () => {
  for (const options of [{ url: "https://other.redunisol.com.ar" + SOURCE_PATH }, { url: SOURCE_URL + "/" },
    { url: SOURCE_URL + "/extra" }, { method: "GET" }, { url: "http://" + SOURCE_HOST + SOURCE_PATH },
    { url: "https://" + SOURCE_HOST + ":8443" + SOURCE_PATH }, { disabled: true }]) {
    const original = await request(options);
    let sent = 0;
    const ctx = context();
    const env = environment(async () => { sent += 1; });
    if (options.disabled) env.SHADOW_CAPTURE_ENABLED = "false";
    const response = new Response("pass", { status: 307, headers: { Location: "/unchanged" } });
    const result = await worker({ fetchImpl: async (actual) => {
      assert.equal(actual, original); if (actual.body) await actual.arrayBuffer(); return response;
    } }).fetch(original, env, ctx);
    assert.equal(result, response); assert.equal(ctx.promises.length, 0); assert.equal(sent, 0);
  }
});

test("raw byte limit includes exactly 40000 and skips larger unknown-length streams", async () => {
  for (const size of [8000, MAX_RAW_BYTES, MAX_RAW_BYTES + 1]) {
    const raw = new Uint8Array(size).fill(42);
    const sig = await signature(raw);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } });
    const original = new Request(SOURCE_URL, { method: "POST", duplex: "half", body: stream,
      headers: { "x-signature": sig, "content-type": "application/json" } });
    const copies = [];
    const ctx = context();
    const response = await worker({ fetchImpl: async (actual) => {
      assert.equal((await actual.arrayBuffer()).byteLength, size); return new Response("ok");
    } }).fetch(original, environment(async (copy) => copies.push(copy)), ctx);
    await ctx.finish();
    assert.equal(response.status, 200); assert.equal(copies.length, size > MAX_RAW_BYTES ? 0 : 1);
    if (copies.length) assert.ok(JSON.stringify(copies[0]).length < 64000);
  }
});

test("consumer uses only delivery auth and acknowledges the matching durable receipt", async () => {
  const body = await envelope();
  const item = message(body);
  await worker({ fetchImpl: async (url, options) => {
    assert.equal(url, DELIVERY_URL); assert.equal(options.method, "POST"); assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Authorization, "Bearer " + TOKEN);
    assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "Authorization", "Content-Type"]);
    assert.deepEqual(JSON.parse(options.body), body);
    return Response.json(acknowledgement(body, { ingest_status: 400 }));
  } }).queue({ messages: [item] }, environment());
  assert.equal(item.acknowledgements, 1); assert.deepEqual(item.retries, []);
});

test("duplicate delivery preserves its UUID, body and signature across consumer attempts", async () => {
  const body = await envelope();
  const deliveries = [];
  const instance = worker({ fetchImpl: async (url, options) => {
    const delivery = JSON.parse(options.body); deliveries.push(delivery);
    return Response.json(acknowledgement(body, { duplicate: deliveries.length > 1 }));
  } });
  for (const attempts of [1, 2]) {
    const item = message(body, attempts); await instance.queue({ messages: [item] }, environment());
    assert.equal(item.acknowledgements, 1);
  }
  assert.deepEqual(deliveries, [body, body]);
});

test("pending, wrong receipt, non-2xx, redirect, malformed and oversized ACKs retry individually", async () => {
  const body = await envelope();
  for (const response of [
    () => Response.json({ status: "pending" }, { status: 202 }),
    () => Response.json(acknowledgement(body, { delivery_id: "wrong" })),
    () => Response.json(acknowledgement(body, { body_sha256: "0".repeat(64) })),
    () => Response.json(acknowledgement(body, { ingest_status: 503 })),
    () => Response.json(acknowledgement(body, { ingest_status: "200" })),
    () => Response.json(acknowledgement(body, { shadow_only: false })),
    () => new Response("failed", { status: 503 }),
    () => new Response("redirect", { status: 307, headers: { Location: "https://never-follow.invalid/unsafe" } }),
    () => new Response("not-json"), () => new Response("x".repeat(2049)),
  ]) {
    const item = message(body, 2);
    let fetches = 0;
    await worker({ fetchImpl: async (url, options) => {
      fetches += 1;
      assert.equal(url, DELIVERY_URL);
      assert.equal(options.redirect, "manual");
      return response();
    } }).queue({ messages: [item] }, environment());
    assert.equal(item.acknowledgements, 0); assert.deepEqual(item.retries, [{ delaySeconds: 30 }]);
    assert.equal(fetches, 1, "A redirect must not trigger a second fetch or send credentials to Location");
  }
});

test("sink timeout retries the same envelope; the unrelated primary remains unaffected", async () => {
  const body = await envelope();
  const item = message(body, 3);
  const logs = [];
  const instance = worker({ deliveryTimeoutMs: 5, log: (record) => logs.push(record),
    fetchImpl: async (input, options) => {
      if (input instanceof Request) { await input.arrayBuffer(); return new Response("primary", { status: 201 }); }
      return new Promise((unused, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } });
  const ctx = context();
  const primary = await instance.fetch(await request(), environment(), ctx);
  await instance.queue({ messages: [item] }, environment()); await ctx.finish();
  assert.equal(primary.status, 201); assert.equal(await primary.text(), "primary");
  assert.equal(item.body, body); assert.equal(item.acknowledgements, 0);
  assert.deepEqual(item.retries, [{ delaySeconds: 60 }]); assert.match(JSON.stringify(logs), /sink_timeout/);
});

test("one failed message cannot retry a successful neighbour; malformed envelope is not delivered", async () => {
  const body = await envelope();
  const malformed = message({ ...body, body_base64: "tampered" });
  const valid = message(body);
  let sends = 0;
  await worker({ fetchImpl: async () => { sends += 1; return Response.json(acknowledgement(body)); } })
    .queue({ messages: [malformed, valid] }, environment());
  assert.equal(sends, 1); assert.equal(malformed.acknowledgements, 0); assert.equal(malformed.retries.length, 1);
  assert.equal(valid.acknowledgements, 1); assert.equal(valid.retries.length, 0);
});

test("committed prepared or active configuration agrees with its manifest and keeps the route bounded", async () => {
  const root = new URL("../", import.meta.url);
  const config = JSON.parse(await readFile(new URL("wrangler.jsonc", root), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const pattern = "https://" + SOURCE_HOST + SOURCE_PATH + "*";
  function validate(actual, desired) {
    assert.ok(["prepared-not-applied", "active"].includes(desired.status));
    const active = desired.status === "active";
    assert.equal(actual.name, "metamap-webhook-shadow"); assert.equal(desired.worker, actual.name);
    assert.equal(actual.workers_dev, false); assert.equal(actual.preview_urls, false); assert.equal(desired.workers_dev, false);
    assert.equal(Object.hasOwn(actual, "route"), false, "Only the reviewed routes array may configure routing");
    assert.equal(actual.vars.SHADOW_CAPTURE_ENABLED, String(active)); assert.equal(desired.capture_enabled, active);
    assert.equal(desired.route.enabled, active); assert.equal(desired.route.pattern, pattern);
    assert.equal(desired.route.zone_name, "redunisol.com.ar");
    assert.equal(desired.route.required_request_limit_failure_mode, "open");
    assert.equal(desired.route.activation_requires_observed_fail_open_setting, true);
    if (active) {
      assert.equal(desired.route.request_limit_fail_open, true, "Active state requires observed fail-open confirmation");
      const route = { pattern };
      if (desired.route.zone_id !== undefined) {
        assert.match(desired.route.zone_id, /^[0-9a-f]{32}$/);
        route.zone_id = desired.route.zone_id;
      } else { route.zone_name = "redunisol.com.ar"; }
      assert.deepEqual(actual.routes, [route], "Active routing must contain exactly the agreed route");
    } else { assert.deepEqual(actual.routes, []); }
    assert.equal(actual.observability.logs.invocation_logs, false);
    assert.deepEqual(actual.queues.producers, [{ binding: "SHADOW_QUEUE", queue: "metamap-webhook-shadow" }]);
    assert.equal(desired.queue, "metamap-webhook-shadow");
    assert.deepEqual(actual.queues.consumers, [{ queue: "metamap-webhook-shadow", max_batch_size: 1,
      max_batch_timeout: 1, max_concurrency: 1, max_retries: 3, retry_delay: 15,
      dead_letter_queue: "metamap-webhook-shadow-dlq" }]);
    assert.equal(desired.dead_letter_queue, "metamap-webhook-shadow-dlq"); assert.equal(desired.dead_letter_consumer, null);
    assert.equal(desired.raw_body_limit_bytes, MAX_RAW_BYTES);
    assert.equal(desired.production_backend_enabled, false); assert.equal(desired.production_cutover, false);
  }
  validate(config, manifest);

  // Exercise both supported states without editing or activating the committed configuration.
  const preparedConfig = structuredClone(config);
  const preparedManifest = structuredClone(manifest);
  preparedConfig.routes = []; preparedConfig.vars.SHADOW_CAPTURE_ENABLED = "false";
  preparedManifest.status = "prepared-not-applied"; preparedManifest.capture_enabled = false; preparedManifest.route.enabled = false;
  validate(preparedConfig, preparedManifest);
  const activeConfig = structuredClone(preparedConfig);
  const activeManifest = structuredClone(preparedManifest);
  activeManifest.status = "active"; activeManifest.capture_enabled = true; activeManifest.route.enabled = true;
  activeManifest.route.request_limit_fail_open = true;
  delete activeManifest.route.zone_id;
  activeConfig.routes = [{ pattern, zone_name: "redunisol.com.ar" }]; activeConfig.vars.SHADOW_CAPTURE_ENABLED = "true";
  validate(activeConfig, activeManifest);
  for (const mutate of [
    (candidate) => { candidate.config.routes.push({ pattern: "https://" + SOURCE_HOST + "/*", zone_name: "redunisol.com.ar" }); },
    (candidate) => { candidate.config.routes[0].pattern = "https://" + SOURCE_HOST + "/*"; },
    (candidate) => { candidate.config.vars.SHADOW_CAPTURE_ENABLED = "false"; },
    (candidate) => { candidate.manifest.route.request_limit_fail_open = false; },
    (candidate) => { candidate.manifest.route.enabled = false; },
  ]) {
    const candidate = { config: structuredClone(activeConfig), manifest: structuredClone(activeManifest) };
    mutate(candidate);
    assert.throws(() => validate(candidate.config, candidate.manifest));
  }
});
