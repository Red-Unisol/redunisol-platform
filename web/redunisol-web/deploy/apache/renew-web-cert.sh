#!/usr/bin/env bash
set -euo pipefail

# Preserve the hosting panel's renewal behavior for every other certificate.
if [[ "${RENEWED_LINEAGE:-}" == /etc/letsencrypt/live/prestamos.redunisol.com.ar ]]; then
    exec /opt/redunisol-web-prod/apache/renew-prestamos-cert.sh
fi

exec /scripts/letsencrypt_post_renew.sh "$@"
