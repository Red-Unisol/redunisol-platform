# MetaMap webhook shadow: prepared, inactive

This Worker makes an asynchronous, signed copy of the existing webhook. It never
selects a new primary backend or activates the MetaMap application on the dedicated
server. No Cloudflare resources, secrets or routes have been applied by these files.

`wrangler.jsonc` has `workers_dev=false`, `preview_urls=false`, `routes=[]` and
`SHADOW_CAPTURE_ENABLED="false"`. `manifest.json` describes the separate activation
contract; it is not an executable Cloudflare API payload. In particular, its
`required_request_limit_failure_mode` is a review requirement, not a Wrangler key.

## Primary request and eligible copies

The fetch handler calls `fetch(originalRequest)` before reading the cloned body,
validating HMAC or sending to the queue. It returns the original Response object:
no rewritten URL, headers, method, body, redirect, response body or status. A failed
primary fetch is not retried against another server: replaying a consumed webhook
could create duplicate business operations.

Copies require all of:

- `SHADOW_CAPTURE_ENABLED="true"`;
- HTTPS, hostname exactly `kestra.redunisol.com.ar`, normal HTTPS port;
- POST and pathname exactly `/metamap-platform/api/v1/metamap/webhooks`;
- nonempty `METAMAP_WEBHOOK_SECRET`, a valid lowercase hexadecimal
  `x-signature` (HMAC-SHA256 of the exact raw bytes) and producer `SHADOW_QUEUE`;
- at most **40,000 raw bytes**, including bodies without Content-Length.

Query parameters remain unchanged on the primary request but never enter the
copy. The existing handler does not use them. A trailing slash or suffix is
primary-only, preserving any original redirect behavior. Invalid signatures,
oversize bodies, missing configuration, queue errors and shadow receiver failures
cannot replace or modify the primary response. Content-Type is retained as a
printable ASCII string of at most 256 characters, or an empty string when the
header is absent; arbitrary headers, authentication, query strings and
upstream MetaMap credentials are not copied.

Only the clone is consumed, with an incremental size limit. Cancellation of the
clone is never awaited because its tee may wait for the primary stream. Background
capture is registered with `ctx.waitUntil`. Capture before a successful queue
write is **best effort**, not a lossless webhook log: a platform limit, interrupted
invocation or queue rejection can omit a copy. Cloudflare allows up to
[30 seconds of background work after the response](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil).

## Envelope and durable acknowledgement

The queue receives exactly these fields, as JSON:

```json
{
  "version": 1,
  "delivery_id": "UUID-v4-generated-once-per-capture",
  "body_base64": "exact-original-bytes-in-standard-base64",
  "body_sha256": "64-lowercase-hex-characters",
  "signature": "64-lowercase-hex-characters",
  "content_type": "application/json",
  "received_at": "2026-11-13T12:34:56.000Z",
  "primary_status": 200
}
```

`primary_status` is null if the primary fetch failed without an HTTP response.
The consumer revalidates the envelope, raw-byte hash and HMAC, then sends only
that JSON to
`https://metamap-origin.redunisol.com.ar/metamap-shadow/deliveries` with
`Authorization: Bearer <SHADOW_DELIVERY_TOKEN>` and Content-Type/Accept JSON.
It does not follow redirects and limits the entire delivery/ACK read to eight
seconds. Request/response bodies and exception messages are never logged.

ACK requires HTTP 2xx and a bounded JSON response containing:

```json
{
  "delivery_id": "same-UUID-as-envelope",
  "body_sha256": "same-hash-as-envelope",
  "ingest_status": 200,
  "duplicate": false,
  "shadow_only": true
}
```

`ingest_status` must be an integer from 200 through 499: the original handler's
durably recorded application rejection (for example 400) is a successful shadow
delivery. Original handler 5xx, pending state, invalid identities/hashes, malformed
ACKs, redirect responses and transport failures retry. The receiver only emits
2xx after it persists its projection, receipt and deduplication ledger atomically.

The consumer keeps the envelope and UUID unchanged across retries. Each message
is acknowledged or retried individually, so one failure cannot redeliver an
acknowledged neighbour. Backoff is 15, 30, 60 seconds, bounded at 300 seconds.
The configured three retries allow up to four delivery attempts; exhaustion goes
to the **independent** `metamap-webhook-shadow-dlq`, which has no automatic
consumer or replay loop. Cloudflare Queues provides
[at-least-once delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/),
so the receiver must accept identical duplicate UUID/hash pairs idempotently and
reject a reused UUID with another hash.

## Secrets, capacity and staged activation

The only Worker secrets are `METAMAP_WEBHOOK_SECRET` and `SHADOW_DELIVERY_TOKEN`.
Supply them through Cloudflare's secret mechanism from approved private files;
never add values to Wrangler vars, Git, CLI arguments, logs or documentation.
Coordinate webhook-secret rotation with outstanding messages: the consumer and
receiver verify the signature again, so changing the secret can reject queued
messages until the rotation/recovery procedure handles them.

Batch size and concurrency default to one, with one sink request per delivery.
The largest envelope remains below 64 KB after base64 expansion. This stays
within [Queues' 128 KB message limit](https://developers.cloudflare.com/queues/platform/limits/)
and avoids splitting one envelope into several 64 KB billing units.
The [Free plan includes 10,000 Queue operations/day and only 24 hours of retention](https://developers.cloudflare.com/queues/platform/pricing/);
a successful message normally consumes write/read/delete operations and retries
consume additional operations. DLQ is also finite retention, not an archive.

Activation is a separate, explicitly reviewed operation:

1. Verify the isolated receiver, TLS, persistence and duplicate handling with
   synthetic signed fixtures; production MetaMap remains disabled. Record the
   backup boundary explicitly: the earlier synthetic Restic test does not back
   up this new shadow dataset.
2. Create the named source queue and DLQ, provision secrets privately and deploy
   the Worker **without routes and with capture disabled**. Confirm bindings,
   retries, DLQ and sanitized logs. The config disables automatic invocation
   logs, which could otherwise record URL/query metadata.
3. Check actual payload distribution, expected Free-plan operations and measured
   Worker CPU. Exercise queue/sink failure and DLQ recovery with synthetic data.
4. In the activation commit, update this config, manifest and their coherence
   test with the one agreed route and capture enabled. Upload that version with
   `wrangler versions upload --config <config> --secrets-file <private.json>`
   without activating it. Reconcile the narrow route separately, explicitly set
   its request-limit failure mode to **Fail open**, and read that setting back
   before activating the uploaded version at 100% with `wrangler versions deploy`.
   Route failure mode is a platform setting; application try/catch does not
   protect against quota/CPU/memory exhaustion.
   Cloudflare documents [the fail-open bypass for daily request limits](https://developers.cloudflare.com/workers/platform/limits/#daily-requests).
5. Verify a real primary response and a separate matching shadow receipt. Turning
   capture off or removing only this Worker route leaves primary service on its
   existing path. Retain/inspect outstanding queue and DLQ messages separately.

For subsequent code changes, use version upload and version deploy. Reserve
`triggers deploy` for intentional route changes and recheck fail-open after each
such change. Never redeploy this initial inactive config over an active trial:
Wrangler reconciles declared vars and routes, so `routes=[]` would remove the
route and the false flag would disable capture. Keep the actual active config
in Git; a dashboard-only activation is not reproducible.

This directory has no production deployment workflow. Commands that create,
deploy, attach routes or upload secrets require the separate operational scope;
`npm test` and `npm run check` do none of those things.

## Local validation

Node 22+ supplies Request/Response/ReadableStream, WebCrypto and `node:test`.
There are no dependencies, package installation or remote APIs in the tests:

```sh
cd infra/cloudflare/metamap-shadow
npm run check
npm test
```

`node --check` validates the deployable ES module directly; no bundling/transpiling
is needed. Tests use actual Request streams and HMAC operations, with mocked
fetch/queue boundaries. They check unchanged primary bytes/URL/status/headers,
signature failures, limits, async queue failure, sink timeout, duplicate identity,
ACK matching, individual retries and the committed inactive configuration.
