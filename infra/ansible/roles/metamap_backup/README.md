# Separate MetaMap repository and synthetic recovery

This role prepares only the encrypted local Restic repository
/srv/redunisol-backups/restic/metamap. It never selects the foundation/BCRA
repository, captures production data, starts MetaMap or contacts the VPS.

The exact XFS mount must have UUID df29bb35-b77f-4355-a93c-c53a32580267 and differ
from the root filesystem. The role neither mounts nor formats anything. Restic
0.18.0 must already exist; no package is installed by this role.

## Authorization and key custody

All authorization flags default to false:

- metamap_backup_prepare_authorized permits this preparation.
- metamap_backup_initialize_authorized separately permits a new repository/key.
- metamap_backup_key_custody_confirmed declares independent operator custody.
- metamap_backup_revision identifies the reviewed Git SHA40.

Supply metamap_backup_password only in a private controller variables file,
discovered through the canonical local credentials.txt. The operator retains
that new independent random key outside the dedicated. The existing remote key
is compared privately to the supplied custodied copy and is never replaced.
The file /etc/redunisol-metamap/restic-password stays root-owned mode 0600
(an existing 0400 file is also accepted). Sensitive tasks use no_log and never
show a diff.

Initialization refuses unrelated files, different keys and an initialized
repository without this role's private repository.json. An interrupted first
initialization with no receipt requires operator review; do not delete or
reinitialize a repository to make an apply green.

## What the canary proves

Preparation generates a tiny closed SQLite database, random payload and dummy
update metadata in an owned private canary directory. No production rows,
runtime environment, TLS key or signed desktop release enters that fixture.

It performs a real backup into the separate encrypted repository, confirms an
unrelated password is rejected, runs check --read-data over that repository,
restores the exact snapshot into a new isolated 0700 directory, and compares
all fixture SHA-256/size/mode/UID/GID plus SQLite integrity and synthetic rows.
Only successful completion publishes canary.json atomically.

The receipt scope is metamap-synthetic-restic-canary and explicitly states
production_data_protected=false, continuous_backup=false and offsite=false.
The SQLite fixture is clean and closed; it does not replace the migration
helper's tests or prove recovery of the production SQLite/WAL dataset.

Repeated prepare validates the existing snapshot, source, restored fixture and
receipt without creating another snapshot or refreshing its original date.
Verify performs read-only Restic calls with --no-cache and --no-lock; it never
initializes or restores again. Evidence lives below
/var/lib/redunisol-foundation/metamap-backup and isolated restores below
/srv/redunisol/state/metamap-server/restores/backup-canary.
Interrupted canaries retain their private artifacts; none are deleted
automatically. A damaged accepted receipt fails verification instead of being
silently replaced.

## Procedure

First apply the separate inactive MetaMap preparation, which creates the
state/restores parent. The existing foundation supplies the backup mount,
restic parent and libexec parent; their ownership/modes are not changed here.

From infra/ansible, with private variables containing the reviewed revision,
explicit preparation/initialization/custody flags and custodied password:

    ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-backup-prepare.yml \
      --limit dedicated_prod_01 --check --diff --extra-vars @/private/metamap-backup.yml
    ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-backup-prepare.yml \
      --limit dedicated_prod_01 --extra-vars @/private/metamap-backup.yml
    ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-backup-verify.yml \
      --limit dedicated_prod_01 --extra-vars @/private/metamap-backup-verify.yml

Check mode validates contracts only, not empty-host installation or working
backups. Repeat the real prepare to check changed=0. Verify needs only the
reviewed revision and fixed nonsecret defaults, not the password value or
write authorization; it uses the existing private remote key.

## Production protection remains a separate gate

retention-policy.json records a proposed 7 daily / 4 weekly / 6 monthly policy.
It is deferred: no timer, forget, prune, unlock or automatic deletion is installed.
Enforcement needs separate review and authorization after real snapshots exist.

Before production activation, a different receipt must bind the consistent
real data+updates snapshot to the cold manifest, immutable image and cutoff,
prove encrypted backup and complete isolated dataset recovery, and define
ongoing backup/retention. This synthetic canary cannot satisfy that gate.
Local SATA still shares the host's failure domain; no offsite recovery is claimed.
