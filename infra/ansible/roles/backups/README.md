# Foundation file backup and restore evidence

This role prepares restic, private state, redacted audit logs, textfile metrics
and systemd backup/check timers for ONE selected repository. It is disabled by
default: BACKUP INCOMPLETE and foundation_backup_configured=0. It never formats,
mounts, initializes, forgets, prunes, unlocks or deletes a real repository.

## Selected destination and activation contract

foundation_backups_repository_kind is offsite (default) or local.

Offsite: foundation_backups_repository is an existing remote URI without embedded
passwords, signed queries or fragments; foundation_backups_repository_is_offsite
must be explicitly confirmed by an operator. Offsite location is not inferred
from a disk label or installation success.

Local: specify foundation_backups_local_mountpoint and its exact
foundation_backups_local_mount_uuid. The repository must be an existing initialized
directory strictly below that mountpoint. findmnt must confirm the exact target,
UUID and a block device distinct from the root filesystem. Repository/config and
the canonical repository path must already exist within that filesystem. These
checks run again at job execution so a missing mount cannot silently redirect
backup writes into the root filesystem. Preparing the filesystem, choosing a
physical disk and initializing the repository are separate approved operations.

A local disk protects against some logical/data-loss events, but shares this
server's failure domain. It supplies no offsite protection. This first version
selects one repository; a second independent/offsite copy remains an evolution
required before critical application data is entrusted to this system.

For either destination, activation also requires:

- foundation_backups_enabled=true and foundation_backups_repository_initialized=true.
- foundation_backups_key_custody_confirmed=true: key/password kept outside this
  machine, with an identified recovery custodian.
- foundation_backups_password_file already exists as a nonempty root-owned regular
  file, mode 0400 or 0600. The role never generates a real repository key.
- Optional backend credentials already exist in foundation_backups_environment_file
  with the same ownership/mode. systemd reads literal EnvironmentFile assignments;
  scripts never source or eval that file.
- foundation_backups_source_paths catalogs consistent platform files and
  foundation_backups_consistency_confirmed=true. Database storage/Docker data
  directories are not file-backup sources; produce separately consistent exports.

Runtime guards reject standard database roots, PostgreSQL/MySQL marker files and
overlap between a local repository and a source. Those guards do not establish
consistency of arbitrary application files; the catalog and operator confirmation
remain necessary. No application database is backed up in this foundation step.

## Operation, scope and evidence

The default backup timer is daily at 03:00 Argentina time; check is Sunday at
05:00, with randomized delay and Persistent=true. Provisioning does not explicitly
execute a backup, although an enabled persistent timer may fire a missed run.
One nonblocking flock serializes operations; overlap exits 75 without refreshing
successful timestamps. Retries/timeouts are bounded. Every nonzero restic exit,
including a partial backup, remains a failure.

Raw backend output is private and removed after extracting the snapshot ID. It
is not echoed to journal/audit logs. Atomic JSON evidence records job, revision,
host, timestamps, duration, attempts, stage, exit code, snapshot ID, check mode
and repository kind. Redacted audit logs rotate daily, 14 rotations, root-only.
State/evidence live under foundation_backups_state_directory.

foundation_backup_configured means activation configuration passed, not that a
backup succeeded. foundation_backup_offsite_configured additionally requires
kind=offsite. repository_kind_info labels local/offsite explicitly. Runtime
foundation_backup_success / foundation_backup_check_success and attempt/success,
exit-code/duration metrics reflect actual operations. Monitoring publishes age
and stale state. Missing timestamps are not healthy.

foundation_backups_check_mode is full (default --read-data), metadata or subset
(--read-data-subset=N/T). Full checks read all data: budget transfer and duration.
A metadata-only success does not verify every data blob; repeating a fixed subset
does not eventually cover all subsets. Retention/pruning is deliberately absent.

tasks/verify.yml only reads units, metrics, mounts and existing run evidence.
Enabled verification requires successful fresh backup/check evidence with the
current selected kind/check mode. A running timer alone is not successful backup
protection. External scrape/alerts and restoration of real data remain separate.

## Manual local fixture restore test

After an authorized apply:

    /usr/local/libexec/redunisol-foundation/restore-smoke --run-local-fixture

That explicit flag creates a unique run under
foundation_backups_restore_smoke_directory with a tiny synthetic dataset and a
new LOCAL FIXTURE repository/password, independent of either real destination.
It runs backup, check --read-data, restore --verify and SHA-256 comparison.
Repository, disposable key, restored fixture, verified.txt and evidence.json are
retained for inspection. Nothing is automatically deleted.

Its metrics are foundation_restore_smoke_* with local_only=1; evidence states
offsite_restore_tested=false. Success proves only that the fixture round-trips,
not recovery of a real local/offsite backup, application data or PostgreSQL.

A real recovery exercise must select a real snapshot and a new isolated empty
target, use the custodied key, validate data/application consistency, and record
snapshot, checksums, recovery point and elapsed time. Never restore over production.

Check mode validates contracts and skips package/file/service mutations. It is
not an empty-host deployment simulation and does not evidence working backups.
Two SATA disks and an installed timer are not completed backup protection.
