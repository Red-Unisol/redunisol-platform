# Initial cold BCRA backup

This separate, manually authorized playbook creates one real initial backup before
the BCRA application starts on the dedicated host. The default authorization is
false. It does not enable a timer or establish continuous or offsite protection.

The existing foundation SATA repository, encryption key/password file and key
custody are reused. The role never initializes, forgets, prunes, unlocks or
reconfigures that repository. It shares the foundation `job.lock`, but keeps its
own cache, restored proof and receipt. It does not replace foundation backup/check
receipts or metrics. A later foundation full repository check also reads BCRA
blobs, so its volume and duration increase.

Before backup, the role requires:

- The exact dedicated identity and SATA filesystem UUID, distinct from root.
- A root-owned private `data-migration.json` with the pinned image, proven copy,
  SQLite verification, transfer access revocation and post-recovery inventory hash.
- `post-recovery-manifest.json` matching that hash and the actual destination tree.
- The BCRA application stopped and no running container with a writable mount
  overlapping its data directory.

Only the destination is hashed, with a maximum read rate of 128 MiB/s. The same
inventory implementation used for copy validation verifies the tree before and
after backup. Data and configuration must remain unchanged during the operation.

The snapshot includes the BCRA data directory, the migration receipt and Compose
configuration. It excludes `api.env` and the restic password. Tags distinguish
`redunisol-bcra-cold`, the service, migration manifest, cutoff and Compose hash.
An uncertain backup acknowledgement is reconciled using those exact tags and
source paths; ambiguous snapshots require operator review.

The role verifies repository identity, snapshot ID, tags and source paths, then
runs a real `restic check --read-data` over the entire encrypted repository while
holding the same lock. Backup, complete pack verification and restoration share
one timeout budget. No receipt is issued if the full read fails or times out.
The receipt records `repository_integrity_verified=true`, `read_data=true` and
the UTC completion time; application activation requires these fields.

It then restores only `data-migration.json` to a new isolated private directory
and compares its SHA-256. It does not restore application databases or overwrite
live files. This proves a real initial cold snapshot, complete encrypted-repository
verification and a small restoration, not a full application recovery rehearsal.

Reapplying with the same valid initial receipt checks repository/snapshot identity
and the restored manifest hash, then reuses that receipt without another full
read or changing its original integrity timestamp. This initial proof does not
replace recurring repository health checks. A snapshot without a valid receipt
must pass the full read before a new receipt can be produced.

Success writes root-owned mode `0600` files:

- `/srv/redunisol/platform/bcra-file-api/cold-backup.json`
- The restored manifest beneath
  `/var/lib/redunisol-foundation/bcra-cold-backup/restore/`.

Use the reviewed Linux/WSL controller and private operation variables:

```sh
ansible-playbook -i inventories/production/hosts.yml \
  playbooks/bcra-backup-cold.yml --extra-vars @/private/operation.json
```

The operation variables set `bcra_backup_apply_authorized=true`, the reviewed
40-character `bcra_backup_revision` and the actual
`bcra_file_api_data_manifest_sha256`. No secret value belongs in shell arguments
or Git. After success, pass the actual cold receipt SHA-256 as
`bcra_file_api_cold_backup_receipt_sha256` when requesting `running=true`.
Activation verifies the snapshot/restore receipt against the same image, tree,
migration checksum and cutoff. Preparation with `running=false` does not require
or claim a completed backup.
