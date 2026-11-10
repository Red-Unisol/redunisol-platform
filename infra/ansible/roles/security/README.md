# Host security: fail2ban for SSH

This role installs the reviewed Debian 13 fail2ban package and declares one jail
for SSH. An address that fails `foundation_security_fail2ban_maxretry` logins
within `foundation_security_fail2ban_findtime` is banned for
`foundation_security_fail2ban_bantime` on the watched SSH ports. Addresses in
`foundation_security_fail2ban_ignoreip` are never banned.

It does not change the SSH port, the root login policy or the authentication
methods, and it does not define a firewall policy. Bans are the only nftables
rules it creates, in the table that fail2ban manages itself.

## Files

| File | Purpose |
| --- | --- |
| `defaults/main.yml` | Package version, watched ports, thresholds and never-banned addresses. |
| `tasks/main.yml` | Contract, check-mode description, installation, jail and service. |
| `handlers/main.yml` | When the jail changes: `fail2ban-client --test`, then reload. |
| `tasks/verify.yml` | Read-only: package version, service, configuration test, jail settings and live status. |

## Debian 13 log source

The jail reads the systemd journal. In fail2ban `1.1.0-8` the `sshd` filter
matches `_SYSTEMD_UNIT=ssh.service`, `_COMM=sshd` and `_COMM=sshd-session`, the
process that OpenSSH on Debian 13 uses to log authentication results.

## Before the first apply

- Add the office public address to `foundation_security_fail2ban_ignoreip` in the
  reviewed inventory.
- Confirm on the host, read-only, that the filter recognizes current failures:
  `fail2ban-regex systemd-journal sshd` once fail2ban is installed, or
  `journalctl -u ssh --since -1h | grep -c 'Failed password'` before.

## Operation on the host

- Status: `fail2ban-client status sshd`
- Unban an address: `fail2ban-client set sshd unbanip <address>`
