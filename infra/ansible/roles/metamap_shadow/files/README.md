# Isolated shadow receiver

`shadow-app.py` is mounted as `/shadow/shadow_app.py` in the reviewed immutable
MetaMap image. It imports that image's unchanged `metamap_server` modules. No
MetaMap source, production database, client route or updater route is modified.
Runtime dependencies are already in the image: FastAPI, SQLAlchemy and Uvicorn.
HTTPX is used only by local development tests.

The only network routes are `POST /deliveries`, `GET /health` and `GET /stats`.
Apache maps the isolated delivery prefix through a Unix socket; health and
statistics stay on that local socket and are never publicly routed.
The delivery token is checked with a constant-time comparison before reading the
body. The fixed eight-field version-1 envelope is limited to 60,000 bytes. Its
canonical base64 body is limited to 40,000 bytes; SHA-256 and HMAC-SHA256 are
verified on its exact bytes before the original webhook handler runs. Content
type is at most 256 printable ASCII bytes. An empty value preserves an absent
original header; the internal request does not invent a MIME type.

Environment variables are exclusively:

- `METAMAP_SHADOW_WEBHOOK_SECRET`: existing webhook HMAC secret, at least 16 bytes.
- `METAMAP_SHADOW_DELIVERY_TOKEN`: independent receiver bearer token, at least 32 bytes.
- `METAMAP_SHADOW_DATABASE_URL`: exactly `sqlite+pysqlite:////data/shadow.sqlite`.
- `METAMAP_SHADOW_REVISION`: complete reviewed 40-character Git SHA.

The database parent must exist privately, and the database is an owned `0600`
regular file. A preexisting unmarked database is rejected rather than adopted.
This file must belong to the separate shadow volume; copying production data
into this volume is outside this operation. WAL is used with synchronous FULL
on every connection. The ordinary MetaMap SQL schema is initialized without
bootstrap clients, enrichment credentials or the original application lifespan.
Consequently there is no pending-enrichment recovery or automatic receipt prune.
The original application is invoked only by an in-process ASGI HTTP scope for
its webhook path, with the original body, content type and signature. Neither
the outer bearer token nor arbitrary headers are forwarded. Its response body,
which may contain personal data, is discarded. Handler logs are disabled in this
isolated process; public error messages and statistics contain no payloads.

Each delivery opens `BEGIN IMMEDIATE`. The original store's sessions are bound
to that connection with `join_transaction_mode=create_savepoint`: their commits
cannot commit the outer transaction. Projection, original receipt and the UUID
delivery ledger commit together. Only after that commit does the receiver return
HTTP 200 with `{delivery_id, body_sha256, ingest_status, duplicate, shadow_only}`.
`ingest_status` is the original integer HTTP status. A signed payload rejected by
the original handler with 4xx is recorded and acknowledged with external 200,
preserving that original result. An original 5xx or exception rolls everything
back and returns 503 so the queue can retry. UUID plus the same hash reuses the
acknowledgement without increasing the projection's `event_count`; the same UUID
with a different valid body is rejected with 409.

`/stats` reports aggregate deliveries, duplicates, rejections, processing failures,
validations and receipts. Duplicate counts and original 4xx results are durable;
envelope/authentication rejections and processing failures are process counters
that reset on restart. GET endpoints perform no writes. Health probes a ledger
read; a failed database read makes health or statistics return HTTP 503 with
`status=degraded` and no exception details. Invalid outer envelopes never create
a raw webhook receipt or ledger entry.

This is a bounded comparison trial, not a production replacement or backup.
`recommended_trial_days=7` and `automatic_retention=false` describe a recommended
duration without claiming an applied retention policy or deletion mechanism.
The operator must agree the trial's deadline and stop capture by that deadline,
compare aggregate outcomes, and explicitly remove the private trial dataset
under the agreed retention policy. There is no recurring retention job and no
automatic pruning of a cohort during comparison. A longer trial requires a new
retention decision; the initial run does not authorize indefinite storage.

Local tests run against the canonical source verified identical to the image's
source. They cover real normalized SQL/receipts, exact UTF-8 bytes, concurrent
deduplication, original rejection, rollback between original writes and after
ledger insertion, retry, invalid authentication/envelopes, private storage and
absence of client routes or enrichment network calls.
