# Separate HTTPS origin, without application cutover

This role reuses the reviewed installed Apache binary in its own
`metamap-origin.service`. It does not install packages, enable global Apache
modules, change `apache2.service`, edit the foundation site or reload that site.
Configuration, PID/runtime directory and rotated logs are independent.

The default is inactive. An explicit enabled apply requires its own approval,
full Git revision, existing Apache package version and controller paths to the
certificate, private key and trusted CA file. PEM values do not belong in
inventory or Git. TLS files are staged privately, chain/hostname/lifetime and key
matching are checked before installation, and key operations use `no_log` with
diff disabled. The installed key remains root `0600` below a `0700` directory.

The default listener is `127.0.0.1:18443`. An assigned public address or
`0.0.0.0`, and port 443, require `metamap_origin_public_listen_authorized=true`.
The role does not issue certificates or change DNS. Declare trust accurately:
`cloudflare-origin-ca` is origin trust, not ordinary browser trust;
`private-ca-test` is for an isolated rehearsal; `public-ca` requires the
corresponding real CA chain.

`/health` reports HTTPS transport metadata and explicitly states that the
application is not ready and production cutover has not happened. Every
`/metamap-platform` path returns 503 without a Location header. Backend enablement
is rejected by this stage even with write authorization. The proxy template is
tested only against a synthetic isolated backend: it strips the prefix and
preserves method, raw body, signature/authentication headers, encoded paths,
Range responses and Cache-Control. It cannot activate MetaMap in this stage.

TLS verification uses the trusted CA and exact hostname through `curl --resolve`,
without DNS, redirects or insecure TLS flags. A loaded response configuration
marker detects an interrupted prior reload even when files are already identical;
only the separate origin unit is reconciled. Identical repeated preparation does
not restart it. Verify reads state and never repairs services implicitly.

The existing node_exporter textfile directory receives only static certificate
expiry (Unix UTC), revision, declared trust source, public certificate SHA-256 and
`backend_enabled=0`. There is no static `up` metric or extra timer. Actual origin
service state belongs to the existing foundation health collector; external
scraping and alert delivery still need their separate verification.

Tests use a private ephemeral certificate, random loopback ports and a disposable
Apache process; no operational host or application is involved. Functional tests
use `METAMAP_TEST_APACHE_BINARY` and `METAMAP_TEST_APACHE_MODULE_DIR`, or installed
Apache defaults. Extracted test binaries may additionally need
`METAMAP_TEST_APACHE_LIBRARY_PATH` for their private dependency directory.
