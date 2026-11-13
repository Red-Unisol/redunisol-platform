# Inactive MetaMap migration preparation

`main.yml` prepares only reviewed files and directories. `verify.yml` reads the
result. Neither changes container state, installs credentials, serves an API or
changes public routing. `metamap_running=true` is rejected even with approval.
Any existing container in the proposed Compose project, including a stopped one,
blocks preparation and verification.
Existing `data/` and `updates/` directories must be empty; preparation cannot
adopt a previously copied application state or change its directory permissions.

Preparation requires `metamap_prepare_authorized=true`, `metamap_revision` (full
Git SHA), and `metamap_image` pinned to the approved GHCR repository digest. Check
mode accepts an empty digest, reports it as pending and performs contracts only.
Verification requires the concrete revision and digest used to prepare.

`metamap_prefetch_image` is a separate opt-in, false by default. The role inspects
before pulling from GHCR, using the target Docker client's existing credentials;
it does not log in or obtain images from the VPS. Verify never pulls images.

Compose has only the `activation` profile, `pull_policy: never`, a loopback bind,
and a **required** future `runtime.env`. Only `runtime.env.example` is prepared;
it is not loaded by Compose. `docker compose config --no-env-resolution --quiet`
validates the model without resolving that absent private file. A profile is not
an access control: explicit service targeting can select it. No activation command
is implemented by these playbooks.

`backup.yml` uses only the separate, initially empty `metamap_migration_origins`
group. It requires its own authorization, exact source host/container/image/path
identity and a stopped-writers confirmation. The helper refuses running writers;
the playbook never stops them. Its new `0700` bundle contains private plaintext
data for transfer, not a continuous, encrypted or offsite backup.

`restore.yml` has separate authorization and a trusted manifest SHA-256. The
bundle must already be on the target; no transfer is performed. Restoration goes
only to a new directory under `state/metamap-server/restores/`, never the active
`data/` or `updates/` directories. Parents must exist. An encrypted recoverable
backup with retention and a tested restore remains a prerequisite for activation.

The four service playbooks are independent of foundation provisioning, legacy
deployment, client releases, DNS and any public proxy. See
[`docs/metamap-dedicated-migration.md`](../../../../docs/metamap-dedicated-migration.md)
for the operation variable contracts and pending cutover work.
