# Host security: fail2ban for SSH

This role installs the reviewed Debian 13 fail2ban package and declares one jail
for SSH. An address that fails `foundation_security_fail2ban_maxretry` logins
within `foundation_security_fail2ban_findtime` is banned for
`foundation_security_fail2ban_bantime` on the watched SSH ports. Addresses in
`foundation_security_fail2ban_ignoreip` are never banned.

It does not change the SSH port, the root login policy or the authentication
methods. Its nftables rules implement SSH bans in fail2ban's own table; they do
not constitute a general host firewall policy.

## Files

| File | Purpose |
| --- | --- |
| `defaults/main.yml` | Watched ports, thresholds and never-banned addresses. The package version is empty here. |
| `tasks/main.yml` | Contracts, check-mode plan, installation and convergence of the live SSH jail. |
| `files/sshd.local` | Two-parameter upstream backport for CVE-2026-109786. |
| `tasks/verify.yml` | Read-only package, service, file, effective configuration and live jail checks. |

## Reviewed inventory and active configuration

The production inventory declares the exact package
(`foundation_security_fail2ban_package: fail2ban=1.1.0-8`) and lists
`fail2ban.service` in `foundation_monitoring_expected_services`. It includes both
`/etc/fail2ban/jail.d/redunisol-security.local` and
`/etc/fail2ban/filter.d/sshd.local` in `foundation_backups_source_paths`, extending
the foundation configuration catalog to ten files. Historical eight-file
snapshots remain valid subsets of the approved catalog. The applied checkpoint
below records recovery of all ten files after application; future changes need
their own backup and isolated restore evidence.

Installation uses APT `policy_rc_d: 101` to prevent package auto-start. The role
copies the managed jail and filter override, runs `fail2ban-client --test`, and
only then starts the service. Every apply reads the effective live policy even
if those files are unchanged. It reloads when that policy differs from the
reviewed settings and probes again to assert convergence. This sequence uses no
deferred reload handler: a previous interrupted apply cannot leave stale live
settings undetected on the next run.

For an existing jail, reconciliation uses `reload --restart sshd` so backend
and action changes are activated. Debian 1.1.0 rejects named reloads for an
absent jail; in that case a configuration-wide `reload` recreates it without
explicitly restarting other jails. The final probe must succeed in either case.

`verify.yml` inspects the package version, service and managed files, validates
the resolved filter configuration and compares the active policy with inventory:
ports, backend, ignore addresses, retry threshold, find time, ban time and ban
action. It does not apply corrections or demonstrate that a real ban has fired.
The health collector reports service liveness; it does not replace these policy
checks or prove external alert delivery. Check mode validates contracts and
describes the plan; it does not simulate an installation on an empty host.

## Debian 13 log source and temporary security backport

The jail reads the systemd journal. The pinned package's `sshd` filter supports
the daemon names `sshd` and `sshd-session`, but Debian's
`jail.d/defaults-debian.conf` overrides the effective journal selector to
`_SYSTEMD_UNIT=ssh.service` **or** `_COMM=sshd`. The active selector has no separate
`_COMM=sshd-session` branch. On 12 November 2026, all 300 inspected
`sshd-session` records belonged to `ssh.service` and were covered by the unit
selector. The active policy probe checks that the loaded selector matches the
resolved Debian configuration.

Debian identifies `1.1.0-8` as affected by
[CVE-2026-109786](https://security-tracker.debian.org/tracker/CVE-2026-109786): a
crafted SSH username can make the filter attribute a failure to another IP.
The managed `filter.d/sshd.local` carries only the two `[DEFAULT]` parameters from
[upstream fix ddd879d22664904ace24e1255ac6571808c58187](https://github.com/fail2ban/fail2ban/commit/ddd879d22664904ace24e1255ac6571808c58187).
It restricts the optional suffix after the client address and leaves the vendor
filter intact. Local regression tests exercise the pinned Debian filter plus
this override, checking both ordinary failures and injected usernames against
the expected client IP. They run without SSH or host services.

This is a temporary backport tied to the reviewed package pin. Remove it only
when a reviewed Debian package pin contains that fix and the same regression
tests pass against the updated package. A version increase alone is insufficient
evidence. Update the installer pin and checksum with the tests and package pin.

## Applied checkpoint: 12-13 November 2026

Revision `6ddeab3310e83517f89fea4592302ca38d3db67a` was applied with authorization
on 12 November: `ok=57 changed=8 failed=0`; the repeated apply returned
`ok=57 changed=0 failed=0`. Full read-only verification on 13 November returned
`ok=100 changed=0 failed=0`, with the service active and enabled, the configuration
test passing, and the active policy probe reporting `matches=true`.

The observed policy used Debian `1.1.0-8` plus the managed backport, SSH ports
`22` and `2241`, five failures within `600` seconds and a `3600`-second ban.
The active ignore list contained the office address authorized on 12 November,
`190.210.65.43`, and loopbacks `127.0.0.0/8` and `::1`. The SSH peer observed on
13 November was `200.61.165.132`, which was not ignored. Whether this is another
network or a dynamic address change remains to be confirmed; the read-only
verification did not add that address or alter host policy.

On 12 November, a temporary ban of documentation address `192.0.2.254` was
confirmed in the jail and nftables set, with a rule covering TCP `22` and `2241`,
then removed. Its absence was confirmed again on 13 November. This tested action
execution and rule creation without failed logins from real users; it did not
test end-to-end packet filtering.

A consistent manual backup and full repository check succeeded on 12 November.
The isolated restore of snapshot
`bae1eed15c0afe62140f59f668880b914eb9d969b1875393c1f939ca5eb8ac3f` recovered ten
files, including the jail and filter override. Independent SFTP verification on
13 November matched SHA-256, size, mode, UID and GID for all ten files. The
root-owned run directory had mode `0700`; the evidence remains at
`/var/lib/redunisol-foundation/restore-local-config/run.QJKFRQ/evidence.json`.
The scope is `real-local-foundation-config`, `local`, `offsite=false`.
See the [foundation checkpoint](../../../../docs/dedicated-foundation.md#seguridad-y-recuperacion-del-12-y-13-de-noviembre)
for the complete evidence and remaining external protection work. This does not
replace the historical eight-file restore evidence from 5 November.

## Before the first apply

- Add the office public management address or CIDR to
  `foundation_security_fail2ban_ignoreip` in the reviewed inventory, preserving
  loopback. Keep that declaration current when the management address changes.
- Review contracts with `provision.yml --check --diff`; authorize the apply
  separately, repeat it to check `changed=0`, then run read-only `verify.yml`.
- Once installed, inspect current journal matching with
  `fail2ban-regex systemd-journal sshd`. Counting SSH log lines alone does not
  prove that the filter matched or attributed their source addresses correctly.
- Make and restore a new configuration snapshot covering both fail2ban files.
  This confirms local recovery within that scope, not an offsite backup.

## Operation on the host

- Status: `fail2ban-client status sshd`
- Unban an address: `fail2ban-client set sshd unbanip <address>`

Runtime reads and any change to bans or configuration follow the repository's
access and authorization rules. Merge alone does not apply this role.
