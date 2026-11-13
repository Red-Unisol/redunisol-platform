# Inactive MetaMap migration preparation

`main.yml` prepares only reviewed files and directories. `verify.yml` reads the
result. Neither changes container state, loads credentials, serves an API or
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
before pulling from GHCR. With the default empty `metamap_registry_auth_file`, it
uses the target Docker client's existing authentication. Verify never pulls.

An optional `metamap_registry_auth_file` points to a private absolute controller
path containing only `{"auths":{"ghcr.io":{"auth":"<base64 user:token>"}}}`.
The role reads it only when prefetch is enabled and the reviewed image is absent.
It rejects unrelated registries, helper stores, extra fields and invalid basic
auth. No new credential is created and registry permissions are not broadened.
The caller must supply an existing credential authorized to pull that package.

For that pull, the role creates an independent `0700` directory under `/run`,
copies the validated configuration as `0600` with `no_log`/diff disabled, and runs
only the digest-pinned image pull with explicit `docker --config` and the local
daemon socket. It does not log in, invoke a credential helper or alter
`/root/.docker`. The temporary directory is removed in `always`, including when
validation/copy/pull fails; the transient fact is cleared and is not cached.
An existing local image causes no credential read or copy. Secrets and their
controller path are absent from `preparation.json`. Secret values never enter
command arguments, tracked templates or Git. Image inspection and verify need
no registry credentials.

Optional private staging copies the existing operator-reviewed environment to
`/etc/redunisol-metamap/runtime.env.pending` with mode `0600`, outside the project.
It requires `metamap_stage_runtime_env=true` and an absolute private controller
source file; no secret content or diff is logged. Verify compares complete bytes.
The pending file is never loaded by Compose. The future active env file uses
`format: raw` so literal dollars and quotes are preserved.

Compose has only the `activation` profile, `pull_policy: never`, a loopback bind,
and a **required** future `runtime.env`. Only `runtime.env.example` is prepared;
it is not loaded by Compose. `docker compose config --no-env-resolution --quiet`
validates the model without resolving that absent private file. A profile is not
an access control: explicit service targeting can select it. No activation command
is implemented by these playbooks.

`backup.yml` uses only the separate, explicitly reviewed `metamap_migration_origins`
group. It requires its own authorization, exact source host/container/image/path
identity and a stopped-writers confirmation. The helper refuses running writers;
the playbook never stops them. Its new `0700` bundle contains private plaintext
data for transfer, not a continuous, encrypted or offsite backup. Source identity
and capture use `raw` without fact gathering or modern remote Ansible modules;
the helper supports Python 3.6 and uses `sqlite_master` on older SQLite versions.

`restore.yml` has separate authorization and a trusted manifest SHA-256. The
bundle must already be on the target; no transfer is performed. Restoration goes
only to a new directory under `state/metamap-server/restores/`, never the active
`data/` or `updates/` directories. Parents must exist. An encrypted recoverable
backup with retention and a tested restore remains a prerequisite for activation.

The four service playbooks are independent of foundation provisioning, legacy
deployment, client releases, DNS and any public proxy. See
[`docs/metamap-dedicated-migration.md`](../../../../docs/metamap-dedicated-migration.md)
for the operation variable contracts and pending cutover work.
