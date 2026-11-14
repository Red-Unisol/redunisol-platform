# Firewall del host

Firewall de entrada del dedicado con nftables. Todo lo que entra se descarta salvo
lo que esta política permite; la salida no se filtra. El rol administra solo su
propia tabla (`inet redunisol_firewall`): no toca las tablas de Docker ni la de
fail2ban, y nunca hace `flush ruleset`.

El inventario de producción lo deja **desactivado** (`foundation_firewall_enabled: false`).
Con el rol desactivado, `provision.yml` solo ejecuta sus controles y `verify.yml`
comprueba que el host no tenga la tabla ni el servicio. Activarlo es un cambio de
inventario aparte, revisado y autorizado.

## Política (etapa 1: no cerrar nada que hoy se use)

Relevada en el host el 14/11/2026 (`ss -tulpn`, `ip -br addr`, `snmpd.conf`, `ntp.conf`
y logins SSH desde la entrega).

| Entrada | Desde | Motivo |
| --- | --- | --- |
| TCP 2241 | Todos | SSH de administración, Ansible y enlace BCRA. fail2ban lo sigue vigilando |
| TCP 22 | Solo DonWeb | El proveedor entra por SSH (6 logins desde 200.58.112.191); no se sabe por qué puerto |
| TCP 443 | Solo rangos de Cloudflare | `metamap-origin` y futuras webs: se llega solo a través del proxy |
| UDP 161 | Solo DonWeb | Monitoreo SNMP del proveedor (viene en su imagen; `snmpd.conf` ya limita a esos orígenes) |
| TCP 9100 | Solo la VPS Monitoreo | Métricas. Hoy el exporter escucha en loopback: la regla queda lista para cuando se conecte |
| Ping e ICMPv6 esencial | Todos | Diagnóstico (con límite) y funcionamiento de IPv6 |
| Respuestas y loopback | — | Conexiones iniciadas por el host y tráfico interno (túnel BCRA → API) |
| Redes de Docker → host | `docker0`, `br-*` | Se mantiene como hoy |

Queda cerrado todo lo demás. En particular **UDP 123**: ntpd respondía la hora a
cualquiera; el host sigue sincronizando porque las respuestas a sus consultas entran
por la regla de conexiones establecidas.

**Docker:** lo que un contenedor publica no pasa por `input` sino por `forward`. La
cadena `forward` (política `accept`) descarta solo las conexiones **nuevas que entran
por la interfaz pública**: si algún día un contenedor publica en `0.0.0.0` por error,
igual no se llega desde internet. La salida de los contenedores, sus respuestas y el
tráfico entre ellos no cambian.

## Cómo aplica sin dejar a nadie afuera

1. `assert`: puertos fijos, el SSH del firewall igual a `foundation_expected_ssh_port`,
   listas completas y con formato de IP. Si algo falla, no se toca el host.
2. La plantilla se escribe en `/etc/redunisol-firewall/rules.nft` validada con
   `nft -c` antes de reemplazar el archivo.
3. Se compara contra `/etc/redunisol-firewall/rules.confirmed.nft` (lo último que pasó
   la confirmación) y contra la tabla cargada. Si coinciden, no hace nada (`changed=0`).
4. Si difieren, `tasks/load.yml` hace una carga confirmada:
   - programa en el host una vuelta atrás con `systemd-run` (`foundation_firewall_rollback_seconds`,
     300 s por defecto);
   - carga las reglas con `nft -f` (una sola transacción, sin instante a medio cargar);
   - cierra la conexión SSH y abre una nueva **a través** de las reglas activas;
   - si entra, guarda las reglas como confirmadas y cancela la vuelta atrás.

   Si no entra, Ansible falla y la vuelta atrás (`/usr/local/libexec/redunisol-firewall/rollback`)
   restaura las últimas reglas confirmadas o, si nunca hubo, quita la tabla. Queda
   registrado con `journalctl -t redunisol-firewall`. Esperar el plazo antes de reintentar.
5. `redunisol-firewall.service` carga en cada arranque **solo las reglas confirmadas**.
   Arranca después de `nftables.service` de Debian, cuyo `flush ruleset` las borraría.

## Aplicar (cuando se decida activarlo)

1. Cambiar en el inventario revisado `foundation_firewall_enabled: true` y revisar las
   listas (Cloudflare publica sus rangos en `https://www.cloudflare.com/ips-v4` e `ips-v6`;
   DonWeb, en `/etc/snmp/snmpd.conf`).
2. Ver el plan sin cambios:

   ```bash
   ansible-playbook -i inventories/production/hosts.yml playbooks/provision.yml \
     --limit dedicated_prod_01 --tags firewall --check
   ```

3. Aplicar solo el firewall, con la autorización y la revisión que exige `provision.yml`:

   ```bash
   FOUNDATION_REVISION="$(git rev-parse HEAD)"
   ansible-playbook -i inventories/production/hosts.yml playbooks/provision.yml \
     --limit dedicated_prod_01 --tags firewall \
     --extra-vars "foundation_apply_authorized=true foundation_revision=$FOUNDATION_REVISION"
   ```

4. Repetir el paso 3 y comprobar `changed=0`; después `verify.yml --tags firewall`.
5. Comprobar por fuera: SSH 2241, `ntpq -pn` con `reach` 377, el enlace BCRA desde la
   VPS y `metamap-origin` a través de Cloudflare.

Al activarlo conviene, en el mismo cambio, sumar `redunisol-firewall.service` a
`foundation_monitoring_expected_services` y los dos archivos de reglas al catálogo de
backups. No se hace ahora porque con el rol desactivado esos archivos no existen y el
monitoreo y el backup los reportarían como faltantes.

## Verificación (`tasks/verify.yml`, solo lectura)

- Desactivado: que no exista la tabla ni el servicio.
- Activado: archivos idénticos a Git; lo escrito igual a lo confirmado; servicio
  habilitado y activo; sin vuelta atrás pendiente; reglas activas **exactamente** iguales
  a las confirmadas (se cargan en una red descartable con `unshare --net` y se comparan
  los dos listados de nft); orígenes SNMP del firewall iguales a los de `snmpd.conf`.

## Retirarlo

`foundation_firewall_enabled: false` no borra un firewall ya aplicado. Para retirarlo,
en el host:

```bash
systemctl disable --now redunisol-firewall.service
nft delete table inet redunisol_firewall
rm -r /etc/redunisol-firewall /usr/local/libexec/redunisol-firewall
rm /etc/systemd/system/redunisol-firewall.service && systemctl daemon-reload
```

## Fuera de esta etapa

- Limitar el 2241 a orígenes conocidos o a la VPN.
- Filtrar la salida.
- Revisar el acceso SSH del proveedor (claves y puerto 22).

## Pruebas

`tests/test_firewall.py` ejecuta los `assert` del rol con el inventario de producción,
renderiza la plantilla y, si el controlador lo permite, la carga dos veces con `nft`
dentro de un espacio de usuario y de red descartable. La carga confirmada, la vuelta
atrás (con y sin reglas confirmadas previas), el reinicio, `--check`, la tabla borrada
a mano y `verify.yml` se probaron el 14/11/2026 contra un contenedor Debian 13 con
systemd y SSH en el 2241.
