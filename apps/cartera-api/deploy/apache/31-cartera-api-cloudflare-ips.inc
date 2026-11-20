# Rangos de Cloudflare (https://www.cloudflare.com/ips-v4 y ips-v6), bajados el 2026-11-20.
# Lo usa solo 31-cartera-api-redunisol.conf. Si Cloudflare publica rangos nuevos, actualizar acá.
# La extensión .inc evita que IncludeOptional conf.d/*.conf lo cargue como un sitio.
#
# Se compara CONN_REMOTE_ADDR (la IP de la conexión TCP) y NO "Require ip": en la VPS,
# 15-remoteip.conf (mod_remoteip) reemplaza la IP del cliente por CF-Connecting-IP para todo
# Apache, y "Require ip" vería la IP real del cliente y bloquearía a todos.
# Varias líneas Require = alcanza con que cumpla una (RequireAny).
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '173.245.48.0/20'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '103.21.244.0/22'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '103.22.200.0/22'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '103.31.4.0/22'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '141.101.64.0/18'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '108.162.192.0/18'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '190.93.240.0/20'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '188.114.96.0/20'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '197.234.240.0/22'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '198.41.128.0/17'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '162.158.0.0/15'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '104.16.0.0/13'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '104.24.0.0/14'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '172.64.0.0/13'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '131.0.72.0/22'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '2400:cb00::/32'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '2606:4700::/32'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '2803:f800::/32'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '2405:b500::/32'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '2405:8100::/32'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '2a06:98c0::/29'"
Require expr "%{CONN_REMOTE_ADDR} -ipmatch '2c0f:f248::/32'"
