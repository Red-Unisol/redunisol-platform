#!/bin/sh
# Vuelta atrás del firewall. La ejecuta systemd cuando un apply no se confirmó a tiempo.
# Vuelve a las últimas reglas confirmadas; si nunca hubo, quita nuestra tabla y el host
# queda como estaba antes del firewall. Nunca deja el SSH bloqueado.
set -u

confirmed=/etc/redunisol-firewall/rules.confirmed.nft

if [ -s "$confirmed" ] && /usr/sbin/nft -f "$confirmed"; then
    logger -t redunisol-firewall "vuelta atrás: se restauraron las últimas reglas confirmadas"
    exit 0
fi

/usr/sbin/nft delete table inet redunisol_firewall 2>/dev/null || true
logger -t redunisol-firewall "vuelta atrás: se quitó la tabla redunisol_firewall"
