#!/usr/bin/env bash
# Runs on the dedicated only. Existing proven runtime credentials stay on that host.
set -euo pipefail
umask 077
stage="${1:?Private staging path required}"
revision="${2:?Git revision required}"
[[ "$stage" =~ ^/run/redunisol-metamap-deploy-[0-9]+-[0-9]+$ ]]
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
[[ "$(id -u)" = 0 ]]
base=/srv/redunisol/platform/metamap-server
state=/srv/redunisol/state/metamap-server
[[ -f "$base/runtime.env" && ! -L "$base/runtime.env" ]]
[[ -f "$state/data/metamap_platform_server.db" && -d "$state/updates/transferencias" ]]
[[ -f /etc/redunisol-metamap/restic-password ]]
exec 9>/run/redunisol-metamap-deploy.lock
flock -n 9
image="ghcr.io/red-unisol/metamap-platform-server:dev-$revision"
docker --config "$stage/registry" pull "$image"
digest="$(docker image inspect "$image" --format '{{json .RepoDigests}}' | python3 -c '
import json,re,sys
values=[v for v in json.load(sys.stdin) if re.fullmatch(r"ghcr.io/red-unisol/metamap-platform-server@sha256:[0-9a-f]{64}",v)]
assert len(values)==1,"Missing immutable registry digest"
print(values[0])')"
docker image inspect "$image" --format '{{json .Config.Env}}' | python3 -c '
import json,sys
env=dict(line.split("=",1) for line in json.load(sys.stdin) if "=" in line)
assert env.get("METAMAP_SERVER_GIT_SHA")==sys.argv[1],"Image revision differs"
' "$revision"
printf 'APP_IMAGE=%s\nAPP_GIT_SHA=%s\n' "$digest" "$revision" > "$stage/image.env"
install -m 600 "$base/runtime.env" "$stage/runtime.env"
compose=(docker compose --project-name metamap-server --profile activation)
"${compose[@]}" --env-file "$stage/image.env" --file "$stage/compose.yml" config -q
RESTIC_CACHE_DIR=/var/cache/redunisol-metamap python3 /usr/local/libexec/redunisol-metamap-live-backup.py --revision "$revision"
# Preserve the preceding specification for recovery; never replace the database.
install -m 600 "$base/compose.yml" "$base/compose.yml.before-deploy"
if [[ -f "$base/.env" ]]; then
  install -m 600 "$base/.env" "$base/.env.before-deploy"
fi
install -m 600 "$stage/image.env" "$base/.env"
install -m 640 "$stage/compose.yml" "$base/compose.yml"
"${compose[@]}" --env-file "$base/.env" --file "$base/compose.yml" up --detach --pull never --no-build
python3 - "$revision" <<'PY'
import json,sys,time,urllib.request
for attempt in range(30):
    try:
        with urllib.request.urlopen("http://127.0.0.1:18083/health",timeout=3) as response:
            health=json.load(response)
        assert health["status"]=="ok" and health["git_sha"]==sys.argv[1]
        print(json.dumps(health))
        break
    except Exception:
        if attempt==29: raise
        time.sleep(2)
PY
