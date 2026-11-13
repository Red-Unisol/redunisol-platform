// ES module with only Workers standard APIs; no dependency or application runtime.
export const SOURCE_HOST = "kestra.redunisol.com.ar";
export const SOURCE_PATH = "/metamap-platform/api/v1/metamap/webhooks";
export const DELIVERY_URL = "https://metamap-origin.redunisol.com.ar/metamap-shadow/deliveries";
export const MAX_RAW_BYTES = 40000;
const MAX_ACK_BYTES = 2048;
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENVELOPE_KEYS = ["body_base64", "body_sha256", "content_type", "delivery_id",
  "primary_status", "received_at", "signature", "version"];

class CopyFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

function abandon(stream) {
  // A tee's cancellation can wait for the primary branch: never await it.
  try { void stream?.cancel().catch(() => {}); } catch { /* already locked */ }
}

async function boundedBytes(stream, maximum) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => {});
        throw new CopyFailure("oversize");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function toBase64(bytes) {
  // Bounded below 40 KB, without spreading attacker-controlled arrays into calls.
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_RAW_BYTES / 3) * 4 ||
      value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new CopyFailure("invalid_envelope");
  }
  const decoded = atob(value);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.length > MAX_RAW_BYTES || toBase64(bytes) !== value) throw new CopyFailure("invalid_envelope");
  return bytes;
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(crypto, secret, signature, bytes) {
  if (typeof secret !== "string" || secret.length === 0 || !HEX.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const digest = Uint8Array.from(signature.match(/../g), (pair) => Number.parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", key, digest, bytes);
}

function matchesSource(request) {
  const url = new URL(request.url);
  return request.method === "POST" && url.protocol === "https:" &&
    url.hostname === SOURCE_HOST && url.port === "" && url.pathname === SOURCE_PATH;
}

function contentTypeAllowed(value) {
  return typeof value === "string" && value.length <= 256 && /^[\x20-\x7e]*$/.test(value);
}

function httpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599;
}

// Dependency injection is for isolated node:test fixtures; production uses defaults.
export function createWorker({ fetchImpl = (...arguments_) => fetch(...arguments_),
  cryptoImpl = globalThis.crypto, log = (record) => console.log(JSON.stringify(record)),
  deliveryTimeoutMs = 8000 } = {}) {
  function record(event, envelope, extra = {}) {
    // No URLs, query strings, arbitrary headers, bodies, exception messages or credentials.
    try {
      log({ event, ...(UUID.test(envelope?.delivery_id) ? { delivery_id: envelope.delivery_id } : {}),
        ...(HEX.test(envelope?.body_sha256) ? { body_sha256: envelope.body_sha256 } : {}), ...extra });
    } catch { /* logging is never a delivery or primary-response dependency */ }
  }

  async function capture(request, env, primaryStatus) {
    if (!env.SHADOW_QUEUE?.send || typeof env.METAMAP_WEBHOOK_SECRET !== "string" ||
        env.METAMAP_WEBHOOK_SECRET.length === 0) {
      abandon(request.body);
      throw new CopyFailure("capture_not_configured");
    }
    const signature = request.headers.get("x-signature")?.trim() ?? "";
    const contentType = request.headers.get("content-type") ?? "";
    const declaredLength = request.headers.get("content-length");
    if (!HEX.test(signature) || !contentTypeAllowed(contentType)) {
      abandon(request.body);
      throw new CopyFailure("invalid_signature_or_metadata");
    }
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_RAW_BYTES) {
      abandon(request.body);
      throw new CopyFailure("oversize");
    }
    const receivedAt = new Date().toISOString();
    const bytes = await boundedBytes(request.body, MAX_RAW_BYTES);
    if (!await verifySignature(cryptoImpl, env.METAMAP_WEBHOOK_SECRET, signature, bytes)) {
      throw new CopyFailure("invalid_signature");
    }
    const envelope = {
      version: 1,
      delivery_id: cryptoImpl.randomUUID(),
      body_base64: toBase64(bytes),
      body_sha256: toHex(await cryptoImpl.subtle.digest("SHA-256", bytes)),
      signature,
      content_type: contentType,
      received_at: receivedAt,
      primary_status: await primaryStatus,
    };
    try {
      await env.SHADOW_QUEUE.send(envelope, { contentType: "json" });
      record("shadow_enqueued", envelope, { primary_status: envelope.primary_status });
    } catch {
      record("shadow_capture_failed", envelope, { reason: "queue_send_failed" });
    }
  }

  async function validateEnvelope(envelope, env) {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
        JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(ENVELOPE_KEYS) ||
        envelope.version !== 1 || !UUID.test(envelope.delivery_id) || !HEX.test(envelope.body_sha256) ||
        !HEX.test(envelope.signature) || !contentTypeAllowed(envelope.content_type) ||
        typeof envelope.received_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(envelope.received_at) ||
        !Number.isFinite(Date.parse(envelope.received_at)) ||
        !(envelope.primary_status === null || httpStatus(envelope.primary_status))) {
      throw new CopyFailure("invalid_envelope");
    }
    const bytes = fromBase64(envelope.body_base64);
    if (toHex(await cryptoImpl.subtle.digest("SHA-256", bytes)) !== envelope.body_sha256 ||
        !await verifySignature(cryptoImpl, env.METAMAP_WEBHOOK_SECRET, envelope.signature, bytes)) {
      throw new CopyFailure("invalid_envelope");
    }
  }

  async function deliver(envelope, env) {
    await validateEnvelope(envelope, env);
    if (typeof env.SHADOW_DELIVERY_TOKEN !== "string" || !env.SHADOW_DELIVERY_TOKEN ||
        /[\r\n]/.test(env.SHADOW_DELIVERY_TOKEN)) throw new CopyFailure("delivery_not_configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deliveryTimeoutMs);
    let response;
    try {
      response = await fetchImpl(DELIVERY_URL, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Authorization": "Bearer " + env.SHADOW_DELIVERY_TOKEN,
          "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(envelope),
      });
      if (!response.ok) throw new CopyFailure("sink_status");
      const bytes = await boundedBytes(response.body, MAX_ACK_BYTES);
      let acknowledgement;
      try { acknowledgement = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new CopyFailure("invalid_acknowledgement"); }
      if (acknowledgement?.delivery_id !== envelope.delivery_id ||
          acknowledgement?.body_sha256 !== envelope.body_sha256 ||
          !Number.isInteger(acknowledgement.ingest_status) ||
          acknowledgement.ingest_status < 200 || acknowledgement.ingest_status >= 500 ||
          typeof acknowledgement.duplicate !== "boolean" || acknowledgement.shadow_only !== true) {
        throw new CopyFailure("invalid_acknowledgement");
      }
      return response.status;
    } catch (error) {
      if (controller.signal.aborted) throw new CopyFailure("sink_timeout");
      if (error instanceof CopyFailure) throw error;
      throw new CopyFailure("sink_network_error");
    } finally {
      clearTimeout(timer);
      abandon(response?.body);
    }
  }

  return {
    async fetch(request, env, ctx) {
      let copy;
      try {
        if (env.SHADOW_CAPTURE_ENABLED === "true" && matchesSource(request)) copy = request.clone();
      } catch { record("shadow_capture_failed", null, { reason: "clone_failed" }); }

      // Start the original request before any body read, HMAC or queue operation.
      // Return its original Response object, streaming body, status and headers untouched.
      const primary = fetchImpl(request);
      if (copy) {
        const status = Promise.resolve(primary).then((response) => response.status, () => null);
        const background = capture(copy, env, status).catch((error) =>
          record("shadow_capture_failed", null, {
            reason: error instanceof CopyFailure ? error.code : "capture_error",
          }));
        try { ctx.waitUntil(background); }
        catch { record("shadow_capture_failed", null, { reason: "wait_until_failed" }); }
      }
      return primary;
    },

    async queue(batch, env) {
      // Batch size 1 by default; individual ack/retry also isolates larger batches.
      for (const message of batch.messages) {
        try {
          const status = await deliver(message.body, env);
          message.ack();
          record("shadow_delivered", message.body, { status });
        } catch (error) {
          const attempts = Number.isInteger(message.attempts) ? Math.max(1, message.attempts) : 1;
          const delaySeconds = Math.min(300, 15 * (2 ** Math.min(attempts - 1, 5)));
          message.retry({ delaySeconds });
          record("shadow_retry", message.body, { attempts, reason: error instanceof CopyFailure ? error.code : "delivery_error" });
        }
      }
    },
  };
}

export default createWorker();
