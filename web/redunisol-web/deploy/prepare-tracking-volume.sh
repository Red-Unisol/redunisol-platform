#!/usr/bin/env bash
# Run once as root. Never discover/format an arbitrary disk or overwrite signatures.
set -euo pipefail
device=/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_7b03dc08-f32e-4a5e-8
serial=7b03dc08-f32e-4a5e-8ad9-d8eff1b3b927
mount_dir=/srv/redunisol-tracking
expected_size=25769803776

[ "$(id -u)" = 0 ]
[ -b "$device" ]
[ "$(lsblk -dn -o SERIAL "$device" | xargs)" = "$serial" ]
[ "$(blockdev --getsize64 "$device")" = "$expected_size" ]
[ "$(lsblk -nr -o NAME "$device" | wc -l)" = 1 ]
if ! blkid -p "$device" >/dev/null 2>&1; then
    [ "${1:-}" = --initialize-blank ] || { echo 'Blank volume: explicit --initialize-blank required.' >&2; exit 1; }
    [ -z "$(wipefs --no-act --noheadings "$device")" ]
    ! findmnt -rn -S "$device" >/dev/null
    ! fuser "$device" >/dev/null 2>&1
    [ -z "$(ls -A /sys/class/block/"$(basename "$(readlink -f "$device")")"/holders)" ]
    # A supported blank, unused device with the exact serial and size above only.
    mkfs.ext4 -m 0 -L redunisol-tracki "$device"
fi
[ "$(blkid -s TYPE -o value "$device")" = ext4 ]
[ "$(blkid -s LABEL -o value "$device")" = redunisol-tracki ]
uuid="$(blkid -s UUID -o value "$device")"
if [ -d "$mount_dir" ] && ! mountpoint -q "$mount_dir"; then
    [ -z "$(ls -A "$mount_dir")" ] || { echo 'Refusing to hide existing mountpoint data.' >&2; exit 1; }
fi
install -d -m 0755 "$mount_dir"
entry="UUID=$uuid $mount_dir ext4 defaults,noatime,nodev,nosuid,noexec,nofail 0 2"
if ! grep -Fqx "$entry" /etc/fstab; then
    ! awk -v target="$mount_dir" '$1 !~ /^#/ && $2 == target { found=1 } END { exit !found }' /etc/fstab
    printf '%s\n' "$entry" >> /etc/fstab
fi
mountpoint -q "$mount_dir" || mount "$mount_dir"
[ "$(findmnt -rn -o UUID --target "$mount_dir")" = "$uuid" ]
printf '%s\n' "$uuid" > "$mount_dir/.redunisol-tracking-volume"
chmod 0644 "$mount_dir/.redunisol-tracking-volume"
for environment in production development local staging testing; do
    install -d -m 2770 -o 33 -g 33 "$mount_dir/$environment"
done
findmnt -rn -o SOURCE,TARGET,FSTYPE,OPTIONS --target "$mount_dir"
df -h "$mount_dir"
