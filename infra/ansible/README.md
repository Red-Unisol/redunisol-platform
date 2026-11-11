# Base administrada con Ansible

Esta carpeta define la base de los hosts de Red Unisol. Su primer destino es
`dedicated_prod_01`: el dedicado Debian 13 que recibira produccion en migraciones
posteriores. La configuracion se revisa en Git antes de aplicarla. Un merge no
ejecuta Ansible ni habilita por si solo el traslado de servicios.

El inventario y la migracion de cada aplicacion se resolveran por servicio
despues. Esta base no despliega aplicaciones, no traslada datos de negocio y no
cambia DNS, webhooks, colas ni schedulers productivos.

## Responsabilidades y limites

| Capa | Responsabilidad de esta base |
| --- | --- |
| Sistema | Configuracion declarativa de Debian, paquetes base, hora y registros. |
| Acceso | Cuentas y claves publicas expresamente configuradas. |
| Seguridad | fail2ban para SSH, con version revisada; sin politica de firewall. |
| Docker | Motor y plugin Compose, configuracion del daemon y verificacion. |
| Proxy | Configuracion base sin publicar los dominios de las aplicaciones actuales. |
| Storage habitual | Validacion de discos y montajes existentes, y creacion de directorios. |
| Preparacion de backup local | Operacion separada y bloqueada por defecto para preparar un unico SATA aprobado; no se ejecuta desde provision. |
| Observabilidad | Agente y comprobaciones del host, con acceso explicito del monitor. |
| Recuperacion | Copias de la configuracion base y comprobaciones de respaldo. |
| Mantenimiento | Revision de actualizaciones y necesidad de reinicio, separada del provisionamiento. |

Por defecto no se cambia el firewall, el puerto SSH ni la politica de login root.
El rol `security` solo agrega fail2ban para SSH: sus bloqueos son las unicas
reglas nftables que crea, en la tabla que administra fail2ban.
Antes del primer apply, agregar la IP publica de gestion de la oficina a
`foundation_security_fail2ban_ignoreip` en el inventario revisado, conservando
loopback. La [guia del rol](roles/security/README.md) describe su backport del
filtro SSH, la convergencia de la politica activa y las comprobaciones posteriores.
El rol `storage` habitual no inicializa, formatea ni monta discos. El rol
`backup_storage` habilitado reconcilia el montaje del UUID ya preparado; no crea
su filesystem desde provision. La preparacion del SATA para backup se declara
aparte, se identifica por serial y requiere un cambio concreto revisado y
autorizado; nunca se deriva de inferir que esta vacio.
MONITOREO y TRANSF conservan sus funciones; el correo
historico se verifica por separado y queda fuera de esta etapa.

## Estructura y destinos

```text
ansible.cfg
requirements-control-node.txt
requirements-dev.txt
requirements-dev.lock
inventories/
  production/hosts.yml
  integration/hosts.yml
playbooks/
  provision.yml
  verify.yml
  maintenance.yml
  storage-prepare.yml
  backup-initialize.yml
  restore-local-config.yml
roles/
tests/
tools/install-test-restic.py
tools/install-test-fail2ban.py
```

`foundation_hosts` selecciona los hosts de esta base. El inventario de produccion
identifica `dedicated_prod_01`, direccion `168.197.51.104`, puerto SSH `2241`.
Estos datos identifican el destino; no son credenciales. El inventario de
integracion no autoriza reutilizar la VPS productiva antes de su liberacion.

## Controlador y credenciales

Usar Linux o WSL amd64 con Python 3.13 y un cliente OpenSSH. Ansible se ejecuta desde ese
controlador, no desde Python nativo de Windows. Desde la raiz del repositorio:

```bash
python3.13 -m venv .venv-ansible
. .venv-ansible/bin/activate
python -m pip install -r infra/ansible/requirements-dev.lock
python -m pip check
cd infra/ansible
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
```

Los archivos `requirements-control-node.txt` y `requirements-dev.txt` expresan la
seleccion de herramientas. `requirements-dev.lock` fija tambien las versiones de
sus dependencias resueltas en Linux/Python 3.13; es lo que instalan CI y el entorno
de validacion. Cambiarlos requiere otra revision y validacion. Consultar el acceso
operativo vigente en `credentials.txt`, fuera de Git, y configurar el agente SSH
o un archivo privado local. No pegar contrasenas en argumentos, inventarios o
logs. Verificar la huella SSH por un canal confiable; no deshabilitar la
comprobacion de identidad del host para hacer pasar una ejecucion.

En WSL es preferible un checkout en el filesystem Linux. Bajo `/mnt/c`, Ansible
puede considerar el directorio world-writable e ignorar el `ansible.cfg` local.
La variable anterior selecciona expresamente el archivo del checkout revisado;
usarla solo despues de comprobar que ese directorio y configuracion son confiables.

Para actualizar el lock, revisar primero los requirements de intencion y resolver
en un venv Linux/Python 3.13 nuevo, sin otras herramientas ni instalaciones
editables. Desde la raiz del repositorio:

```bash
python3.13 -m venv .venv-ansible-refresh
. .venv-ansible-refresh/bin/activate
python -m pip install -r infra/ansible/requirements-dev.txt
python -m pip check
python -m pip freeze > infra/ansible/requirements-dev.lock
```

Revisar que todas las entradas sean versiones exactas, sin rutas locales, URLs
privadas ni `-e`. Validar el nuevo lock en otro venv limpio con los comandos de
esta guia. Actualizar la intencion y el lock en el mismo cambio cuando corresponda.
CI comprueba ademas que las versiones directas declaradas sean compatibles con
el lock. Fijar versiones no sustituye revisar actualizaciones de seguridad ni
constituye una imagen identica del sistema operativo del controlador.

## Validacion sin acceso al servidor

Desde `infra/ansible`:

```bash
yamllint --strict . ../../.github/workflows/validate-ansible.yml
ansible-lint --offline
ansible-inventory -i inventories/production/hosts.yml --graph
ansible-inventory -i inventories/integration/hosts.yml --graph
for playbook in provision verify maintenance storage-prepare backup-initialize restore-local-config; do
  ansible-playbook -i inventories/production/hosts.yml "playbooks/${playbook}.yml" --syntax-check
done
```

Desde la raiz del repositorio:

```bash
python infra/ansible/tools/install-test-restic.py --directory /tmp/redunisol-restic
export FOUNDATION_TEST_RESTIC_BINARY=/tmp/redunisol-restic/restic
python infra/ansible/tools/install-test-fail2ban.py --directory /tmp/redunisol-fail2ban
export FOUNDATION_TEST_FAIL2BAN_ROOT=/tmp/redunisol-fail2ban
python -m unittest discover -s infra/ansible/tests -v
```

El instalador de pruebas descarga Restic `0.18.0` para Linux amd64 desde su
release oficial y comprueba el SHA-256 fijado en el script. No usa root ni instala
paquetes del host. Las pruebas usan repositorios temporales y datos sinteticos;
no configuran backups reales ni recuperan archivos de los servidores operativos.
El segundo instalador extrae el paquete oficial Debian `fail2ban=1.1.0-8` con
SHA-256 fijado, sin instalarlo ni iniciar servicios del host. Las pruebas usan
ese filtro y el override Git para comprobar lineas de log SSH y la atribucion
correcta de la IP frente a un nombre de usuario inyectado (CVE-2026-109786).

El workflow `Validate Ansible foundation` ejecuta estas validaciones en Linux con
Python 3.13 y acciones fijadas por commit. Tiene permisos de lectura del repositorio, no abre SSH, no usa
secretos de produccion y no ejecuta tareas de provisionamiento. Sintaxis y lint
aprobados no demuestran que un host haya sido configurado ni que una restauracion
funcione.

## Provisionar, verificar y mantener

- `provision.yml` converge la configuracion declarada de la base del host.
- `verify.yml` inspecciona el resultado real; no aplica correcciones encubiertas.
- `maintenance.yml` refresca metadata APT y reporta paquetes actualizables y
  necesidad de reinicio, con autorizacion independiente. No actualiza paquetes
  ni reinicia el host; tampoco forma parte de un deploy de aplicacion.
- `storage-prepare.yml` prepara el dispositivo concreto aprobado para backup
  local y su montaje persistente. Es una operacion separada, bloqueada por
  defecto; no inicializa los discos desde el provisionamiento habitual.
- `backup-initialize.yml` inicializa el repositorio local aprobado y comprueba
  sus prerrequisitos. No sustituye ejecutar y verificar la primera copia real.
- `restore-local-config.yml` extrae configuracion desde un snapshot real a un
  directorio nuevo y privado para contrastarla. No restaura sobre `/etc`, no
  modifica los accesos y no aplica esa configuracion al host.

Los procedimientos de storage, inicializacion y restauracion estan definidos en
Git y se aplicaron al dedicado con autorizacion expresa. Su presencia y su
syntax-check no demuestran el estado actual del host: ver la
[evidencia historica de ejecucion](../../docs/dedicated-foundation.md#evidencia-de-aplicacion-y-recuperacion-local).
Las autorizaciones de escritura de cada operacion permanecen desactivadas por
defecto; el inventario declara por separado el estado deseado del storage y backup
ya preparados.

Una futura aplicacion autorizada empieza por revisar inventario y variables,
comprobar el destino y evaluar los cambios:

```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/provision.yml \
  --limit dedicated_prod_01 --list-hosts
ansible-playbook -i inventories/production/hosts.yml playbooks/provision.yml \
  --limit dedicated_prod_01 --check --diff
```

`--check` puede reunir facts y contactar el host. No es una validacion offline ni
una simulacion completa de cambios que dependen de paquetes o servicios que aun
no existen. Revisar el resultado y evitar que un diff muestre secretos.

Una vez autorizada esa intervencion, usar el SHA completo de la revision revisada
y un checkout limpio de esa misma revision. El guard del playbook exige tanto la
autorizacion expresa como esa referencia:

```bash
FOUNDATION_REVISION="$(git rev-parse HEAD)"
ansible-playbook -i inventories/production/hosts.yml playbooks/provision.yml \
  --limit dedicated_prod_01 \
  --extra-vars "foundation_apply_authorized=true foundation_revision=$FOUNDATION_REVISION"
ansible-playbook -i inventories/production/hosts.yml playbooks/verify.yml \
  --limit dedicated_prod_01 \
  --extra-vars "foundation_revision=$FOUNDATION_REVISION"
```

No agregar esos comandos a un workflow de deploy de aplicaciones ni ejecutar
mantenimiento como paso implicito del provisionamiento. Las variables sensibles
deben mantenerse fuera de Git y las tareas que las consuman ocultar su contenido.
`maintenance.yml` exige por separado `foundation_maintenance_authorized=true` y
`foundation_revision` para ejecutarse fuera de check mode. Un futuro upgrade o
reinicio requiere su propia intervencion y criterios de recuperacion.

## Operaciones locales con autorizacion explicita

Primero revisar el [estado declarado del SATA](../../docs/dedicated-foundation.md#storage-local-aplicado)
y el inventario. Puede consultarse el plan sin habilitar las guardas de escritura:

```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/storage-prepare.yml \
  --limit dedicated_prod_01 --check --diff
```

Este comando inspecciona el host, pero no crea el filesystem ni monta el disco.
Un plan valido no acredita que la preparacion haya ocurrido.

La aplicacion posterior requiere una revision Git completa y parametros explicitos
de la intervencion. Estos son los contratos de los tres procedimientos:

| Operacion | Parametros y comprobaciones exigidos |
| --- | --- |
| Preparar SATA | `foundation_apply_authorized`, `foundation_backup_storage_enabled` y `foundation_backup_storage_prepare_authorized` habilitados; `foundation_revision`; confirmacion literal indicada debajo. |
| Inicializar repositorio | `foundation_apply_authorized` y `foundation_backups_initialize_authorized` habilitados; `foundation_revision`; `foundation_backups_key_custody_confirmed`; `foundation_backups_password` privado de al menos 32 caracteres. |
| Restaurar catalogo | `foundation_apply_authorized` y `foundation_backups_restore_authorized` habilitados; `foundation_revision`; `foundation_backups_restore_snapshot` con el ID completo de 64 caracteres hexadecimales, nunca `latest`. |

Para este dispositivo, `foundation_backup_storage_confirmation` debe coincidir
exactamente con:

```text
INITIALIZE ZWD0RX9Q UUID df29bb35-b77f-4355-a93c-c53a32580267
```

Los defaults de autorizacion siguen desactivados. El inventario de produccion
habilita el filesystem y mecanismo de backup ya verificados, sin dejar activas
las autorizaciones de inicializacion o restauracion. No habilitar estas guardas
antes de aprobar la intervencion concreta ni dejarlas como parametros habituales
de deploy. Conservar identidad y UUID del inventario; no seleccionar el disco
solamente por el nombre `/dev/sdb`.

Para una operacion aprobada se puede usar un YAML privado fuera de Git, identificado
por `FOUNDATION_OPERATION_VARS`, con los flags y valores revisados de esa operacion.
Agregar siempre `foundation_revision` de la revision que efectivamente se ejecuta.
La contrasena del repositorio debe leerse de esa fuente privada, nunca de argumentos
con su valor literal ni de documentacion. No se muestran ejemplos de su contenido.
La inicializacion no rota ni reemplaza una clave existente diferente.

Para una reconstruccion autorizada, el orden de ejecucion es el siguiente. El
dedicado ya cuenta con el filesystem y repositorio verificados; no repetir su
inicializacion para realizar un backup habitual.

1. Aplicar `storage-prepare.yml` contra el unico SATA seleccionado y verificar
   UUID, montaje nativo de systemd e idempotencia. El NVMe y el otro SATA siguen
   fuera de esa inicializacion.
2. Aplicar `backup-initialize.yml` con clave custodiada y comprobar que el
   repositorio local se abre con ella. Esto no ejecuta una copia ni activa timers.
3. Registrar el filesystem y repositorio realmente preparados en el estado
   deseado. Revisar las confirmaciones de inicializacion, custodia y consistencia
   antes de habilitar `foundation_backups_enabled`. Mantener
   `foundation_backups_timers_enabled: false` durante la validacion inicial.
4. Provisionar los mecanismos de backup aprobados y ejecutar una primera copia
   real y su comprobacion de integridad. Identificar el snapshot concreto.
5. Aplicar `restore-local-config.yml` con ese ID y verificar el reporte de
   comparacion. El script crea un nuevo directorio privado bajo
   `foundation_backups_restore_local_directory`; no sobrescribe el sistema activo.
6. Habilitar los timers solo cuando esa evidencia resulte satisfactoria y quede
   registrada la decision. Verificar el runtime con la misma revision aplicada.

Estos pasos no se ejecutan desde CI ni equivalen a un traslado de aplicaciones.
Se implementan con Ansible core y herramientas Debian declaradas, sin agregar
colecciones Galaxy al controlador ni cambiar el lock Python para esta operacion.

## Aceptacion y evidencia

El inventario de produccion mantiene el exporter en `127.0.0.1:9100` y
`foundation_external_monitoring_configured: false`. Habilita
`foundation_backup_storage_enabled`, `foundation_backups_enabled` y
`foundation_backups_timers_enabled` tras preparar y verificar el repositorio local.
La programacion deseada es una copia diaria a las 03:00 y una comprobacion completa
los domingos a las 05:00, zona `America/Argentina/Buenos_Aires`, con hasta 15 minutos
de demora aleatoria y `Persistent=true`. Esto declara la programacion; no prueba
por si solo que se haya observado un disparo del timer. El acceso desde
MONITOREO y la politica de red se completan con destinos autorizados y verificados.

Para activar backups hace falta un repositorio real ya inicializado, local o externo,
custodia de su clave, archivo privado de autenticacion y rutas fuente revisadas.
El backend local exige un montaje independiente con UUID verificado y distinto del filesystem raiz; el externo exige un destino confirmado.
Preparar ese montaje corresponde a `storage-prepare.yml`, separado del
provisionamiento habitual; el rol `storage` existente solo lo valida.
Los defaults del rol `backups` exigen confirmar esos datos y la consistencia de
las fuentes. No usar una declaracion `true` para sustituir su verificacion, ni
agregar bases vivas o volumenes de aplicaciones a esa lista sin su procedimiento.

El repositorio local inicializado y verificado es `/srv/redunisol-backups/restic/foundation`,
sobre el filesystem separado con UUID
`df29bb35-b77f-4355-a93c-c53a32580267`. El dispositivo se selecciona por by-id y
serial; ver el [estado de storage](../../docs/dedicated-foundation.md#storage-local-aplicado).
Su preparacion se acredita con la evidencia de ejecucion; los valores en Git por
si solos no sustituyen verificar el runtime.

El catalogo deseado de esta etapa es `foundation_backups_source_paths`, en
[`inventories/production/group_vars/all.yml`](inventories/production/group_vars/all.yml).
Contiene estas diez configuraciones de la base, incluidas la jail y la correccion
del filtro SSH que se incorporan al aplicar el rol `security`:

```text
/etc/docker/daemon.json
/etc/apache2/ports.conf
/etc/apache2/sites-available/redunisol-foundation.conf
/etc/systemd/journald.conf.d/50-redunisol.conf
/etc/apt/apt.conf.d/52redunisol-no-automatic-reboot
/etc/systemd/system/prometheus-node-exporter.service.d/foundation.conf
/etc/systemd/system/redunisol-foundation-health.service
/etc/systemd/system/redunisol-foundation-health.timer
/etc/fail2ban/jail.d/redunisol-security.local
/etc/fail2ban/filter.d/sshd.local
```

El ensayo de restauracion debe usar un snapshot real de ese catalogo, un destino
nuevo `0700` en el mismo host y comparacion de contenido. Acredita recuperacion
de esos archivos dentro de ese alcance, no una reconstruccion integral ni una
copia externa. El snapshot y su resultado deben quedar identificados en la
evidencia. La custodia de la clave del repositorio se comprueba por separado.

La evidencia historica del 5 de noviembre de 2026 verifica una copia real, una
comprobacion completa y la restauracion aislada de los ocho archivos originales,
con comparacion independiente de SHA-256, modo, UID y GID; no acredita todavia
el catalogo ampliado de diez archivos. Despues de aplicar `security`, comprobar
una copia y restauracion nuevas que incluyan ambos archivos de fail2ban. Los
snapshots historicos de ocho archivos siguen siendo restaurables porque el
catalogo permite subconjuntos de las rutas aprobadas.
La clave privada custodiada por el operador fuera del dedicado se uso para abrir
el repositorio. El snapshot y reporte del ensayo estan identificados en la
[evidencia de recuperacion local](../../docs/dedicated-foundation.md#evidencia-de-aplicacion-y-recuperacion-local).
Para revisar los ultimos resultados del host, consultar
`/var/lib/redunisol-foundation/backup-state/backup.json`, `check.json` y
`local-config-restore.json`, y ejecutar `verify.yml` con la revision aplicada.
Los reportes y la copia SATA no acreditan proteccion fuera del host.

Registrar revision Git, inventario y limite usados, hora, operador, resultados y
limitaciones pendientes, sin credenciales ni dumps de variables. La aceptacion
requiere primera aplicacion autorizada, verificacion del runtime y segunda
aplicacion de provisionamiento con `changed=0`. Todo cambio recurrente debe
investigarse y corregirse antes de declarar idempotencia.

Separar la evidencia local de la proteccion externa:

- Base local: runtime verificado, metricas locales recientes y segunda
  aplicacion de provisionamiento con `changed=0`.
- Backup local: dispositivo y montaje correctos, copia real, comprobacion del
  repositorio y restauracion aislada de configuracion real con comparacion.
- Proteccion externa: acceso del monitor y entrega de alertas comprobados, y
  una copia recuperable fuera del dedicado. No se acreditan con una copia SATA.

La conexion externa de monitoreo se difiere expresamente. No bloquea preparar
manifiestos, imagenes e inventarios de futuros despliegues; tampoco habilita
activar produccion ni permite declarar completa la aceptacion de proteccion
externa. Un timer habilitado o una copia local no prueban recuperacion ante
perdida del host. No se inventan endpoints ni credenciales para cerrar pendientes.

Esta base no contiene restauraciones genericas de bases de aplicaciones. Cada
servicio tendra despues su procedimiento de consistencia y recuperacion.
Ver [las puertas de salida de la etapa](../../docs/dedicated-foundation.md).
