# Etapa 1: base reproducible del dedicado

## Resultado buscado

Esta etapa deja una base de host definida en Git, verificable y recuperable para
recibir produccion mas adelante. La implementacion esta en
[`infra/ansible`](../infra/ansible/README.md). Hacer merge de esa configuracion no
equivale a ejecutarla ni demuestra que el dedicado ya cumpla sus condiciones.

La prioridad es reconstruir y observar el servidor y recuperar su configuracion.
El inventario y la migracion de aplicaciones se abordaran por servicio despues;
no son un prerrequisito para escribir esta base.

## Destinos y limites

| Destino | Papel durante esta etapa |
| --- | --- |
| `dedicated_prod_01` | Nuevo dedicado Debian 13; destino exclusivo de la base. |
| VPS actual `5779267` | Conserva sus servicios hasta sus respectivos cortes. |
| MONITOREO `6088737` | Conserva su funcion de observabilidad externa. |
| TRANSF `5967792` | Conserva su funcion operativa. |

La futura asignacion de la VPS actual a integracion depende de liberarla. Mientras
ambos hosts conserven produccion, no hay aislamiento fisico completo de
dev/integracion respecto de produccion. El correo historico se verifica por
separado y no forma parte de esta intervencion.

Esta etapa no traslada aplicaciones, bases, archivos de usuarios, claves OAuth,
colas, schedulers ni webhooks. No cambia DNS o endpoints productivos, no publica
dominios de aplicaciones en el proxy nuevo ni modifica el firewall o el login
root por defecto; fail2ban solo agrega los bloqueos de SSH en su propia tabla
nftables. El provisionamiento habitual nunca inicializa ni formatea los
SATA. El rol `storage` valida identidad y montajes existentes y crea directorios;
`backup_storage`, habilitado expresamente en este inventario, reconcilia el
montaje del UUID de backup ya preparado. La inicializacion del SATA se aplico
mediante una operacion separada y autorizada; su guarda de escritura sigue
desactivada por defecto.

## Modelo de operacion

La base separa tres operaciones revisables y ejecutables de forma independiente:

1. **Provisionar:** configurar sistema, acceso expresamente declarado,
   proteccion de SSH con fail2ban, Docker, proxy base, directorios, validacion
   del storage existente, observabilidad y mecanismos de respaldo.
2. **Verificar:** contrastar runtime con inventario sin aplicar correcciones.
3. **Mantener:** refrescar metadata APT y reportar paquetes actualizables y
   necesidad de reinicio con autorizacion independiente. El playbook actual no
   actualiza paquetes ni reinicia. Esas intervenciones requieren ventana y
   recuperacion propias, separadas del deploy de aplicaciones.

Las credenciales se descubren desde el archivo local `credentials.txt`; no se
copian al inventario ni a documentacion traqueada. Ansible se opera desde
Linux/WSL con herramientas fijadas por version y SSH validado. CI solo valida
codigo sin contactar los hosts operativos.

Antes de aplicar `security`, agregar la IP publica de gestion de la oficina a
`foundation_security_fail2ban_ignoreip` en el inventario revisado, conservando
loopback. El rol impide el arranque automatico del paquete durante la instalacion,
escribe la jail y el override del filtro, valida la configuracion y despues
inicia fail2ban. En cada apply compara la politica activa completa con Git,
recarga si hay deriva y comprueba el resultado; `verify.yml` solo inspecciona.
El pin Debian `1.1.0-8` requiere el backport temporal de CVE-2026-109786 descrito
en la [guia del rol](../infra/ansible/roles/security/README.md). Merge, pruebas
locales y el control de salud del proceso no acreditan por si solos esa proteccion
en el dedicado.

La politica de actualizaciones del proveedor debe verificarse y coordinarse con
este modelo antes de dar por resuelto el mantenimiento. El incidente de
[recuperacion del scheduler de Kestra](kestra-scheduler-recovery-20261103.md)
documenta un reinicio automatico gestionado por Ansible; no acredita que ese
Ansible perteneciera a este repositorio. Una futura migracion debe definir
apagado ordenado y comprobaciones funcionales posteriores de cada aplicacion.

## Storage local aplicado

El procedimiento separado se aplico y verifico sobre un solo SATA. La evidencia
de ejecucion y recuperacion local se registra mas abajo. La asignacion
del rol de backup corresponde a la identidad observada del dispositivo; no es una
confirmacion de que DonWeb etiquete ese serial como su disco de backup.

| Elemento | Estado aplicado y verificado |
| --- | --- |
| Dispositivo | SATA identificado por by-id y serial `ZWD0RX9Q`, actualmente presentado como `/dev/sdb`. |
| Modelo y capacidad | `ST2000VN003-3CW102`, `2000398934016` bytes. |
| Filesystem | XFS sobre el dispositivo completo, etiqueta `ru-backups`. |
| UUID fijado en Git | `df29bb35-b77f-4355-a93c-c53a32580267`. |
| Montaje | `/srv/redunisol-backups`, persistente mediante `srv-redunisol\x2dbackups.mount` de systemd. |
| Fuera del cambio | NVMe raiz y el otro SATA, serial `ZWD0RXD6`. |

Toda preparacion debe comprobar nuevamente identidad, capacidad, firmas,
particiones y montajes antes de inicializar. Un resultado desconocido o una
firma inesperada detienen la operacion; no justifican un borrado forzado. La
convergencia posterior debe reconocer el UUID ya preparado y conservar los datos.
La revision del plan y la aprobacion concreta preceden a activar sus guardas de
inicializacion; sus defaults siguen desactivados. El inventario conserva
habilitada la reconciliacion del filesystem preparado.

## Recuperacion y observabilidad

El catalogo deseado del backup de esta etapa se limita a diez archivos de
configuracion base: los ocho originales, la jail de fail2ban y su override del
filtro SSH. El repositorio cifrado local esta inicializado y verificado; el
inventario de produccion habilita el mecanismo de backup. La evidencia del 5 de
noviembre corresponde a los ocho archivos originales; el checkpoint del 12 y 13
de noviembre acredita una copia y restauracion de los diez. Los snapshots
historicos conservan su catalogo y siguen siendo recuperables.
Las copias consistentes de PostgreSQL, SQLite, adjuntos, tracking o colas se
definiran cuando se incorpore cada servicio. Copiar directorios vivos sin revisar
su contrato no se considera una estrategia de backup valida.

La conexion externa de monitoreo se difiere expresamente. Se conservan el exporter
de loopback y las comprobaciones locales, sin afirmar scraping ni entrega de
alertas externos. Ese diferimiento no bloquea preparar futuras etapas y
despliegues; no autoriza por si mismo activar servicios productivos.

El destino externo de copias sigue pendiente mientras no este configurado y
verificado. Una copia en SATA local no cubre la
perdida completa del dedicado. Un timer habilitado tampoco prueba que exista
una copia externa utilizable: hay que comprobar ejecucion, antiguedad, integridad
y restauracion.

Las pruebas sinteticas validan scripts y guardas; no demuestran la recuperacion
de configuracion real ni la existencia de una copia externa.

No se incluye una restauracion generica de servidores o aplicaciones ni un
`cutover` vacio: esas operaciones necesitan un destino y un contrato real. Una
recuperacion integral del host se ensaya por separado en un destino aislado,
con inventario propio y revision conocida de Git.

Los procedimientos de storage y backup local se separan del deploy:
`storage-prepare.yml` identifica y prepara solo el dispositivo aprobado;
`backup-initialize.yml` inicializa su repositorio; `restore-local-config.yml`
extrae el catalogo acotado de configuracion de un snapshot real a un directorio
nuevo `0700` en el mismo host y lo compara. Este ultimo no sobrescribe `/etc`, no
modifica los accesos ni acredita una reconstruccion integral del servidor.
Su presencia en Git no los ejecuta. Las autorizaciones de inicializacion y
restauracion siguen desactivadas por defecto y se otorgan para cada intervencion.

## Evidencia de aplicacion y recuperacion local

### Base y recuperacion del 5 de noviembre

El 5 de noviembre de 2026 se verificaron las siguientes operaciones autorizadas.
Es evidencia historica: para conocer el estado presente hay que ejecutar
`verify.yml` contra el inventario y la revision correspondientes.

| Operacion | Revision y resultado observado |
| --- | --- |
| Preparacion del SATA y montaje | `0362beb7ed83de5048fa3a0210b32ca8fc0e92b4`: primera aplicacion `ok=28 changed=6 failed=0`; repeticion `ok=25 changed=0 failed=0`. UUID esperado, XFS y unidad nativa activa y habilitada. |
| Inicializacion del repositorio | Primera aplicacion `ok=27 changed=3 failed=0`; repeticion `ok=29 changed=0 failed=0`, conservando la clave existente. La copia privada del operador, fuera del dedicado, se uso para abrir el repositorio. |
| Mecanismo de backup local | `236123f237bce89778b265cf895c34a346b009bc`: provisionamiento `ok=98 changed=6 failed=0`; primera copia y comprobacion completa con `exit_code=0`, `stage=complete` y consistencia de fuentes confirmada. |
| Restauracion aislada real | Ocho de ocho archivos recuperados y comparados de forma independiente por SFTP: SHA-256, modo, UID y GID coincidentes. Alcance `real-local-foundation-config`, `offsite=false`. |

El snapshot recuperado es
`f92b314c743395e930cf1724feec005ae25582481cb6cec822b6c8820834951a`.
Su reporte se conserva en el dedicado en
`/var/lib/redunisol-foundation/restore-local-config/run.M5R1fz/evidence.json`.
Las evidencias de las ultimas operaciones estan en
`/var/lib/redunisol-foundation/backup-state/backup.json`, `check.json` y
`local-config-restore.json`. Estos resultados acreditan la recuperacion local de
ese catalogo acotado; no acreditan datos de aplicaciones ni una reconstruccion
integral del host.

El estado deseado versionado habilita la programacion de copias diarias a las
03:00 y comprobaciones completas los domingos a las 05:00, en
`America/Argentina/Buenos_Aires`, con demora aleatoria de hasta 15 minutos y
`Persistent=true`. La ejecucion programada debe comprobarse por separado: esta
evidencia registra la copia y la comprobacion manuales, no un disparo observado
del timer. Monitoreo externo y copia recuperable fuera del dedicado siguen
pendientes.

### Seguridad y recuperacion del 12 y 13 de noviembre

El 12 de noviembre de 2026 se aplico, con autorizacion expresa, la revision
`6ddeab3310e83517f89fea4592302ca38d3db67a`. El 13 de noviembre se realizaron las
comprobaciones posteriores de solo lectura. Este checkpoint complementa la
evidencia del 5 de noviembre; no reemplaza su snapshot ni amplia su alcance.

| Operacion | Resultado observado |
| --- | --- |
| Aplicacion acotada de `security`, `monitoring`, `backups` y `evidence`, 12 de noviembre | `ok=57 changed=8 failed=0`; repeticion `ok=57 changed=0 failed=0`. |
| Verificacion completa, 13 de noviembre | `ok=100 changed=0 failed=0`. Fail2ban activo y habilitado, prueba de configuracion aprobada y probe de politica activa con `matches=true`. Salud local reciente y servicios esperados activos. |
| Politica SSH | Debian `fail2ban=1.1.0-8` y backport de CVE-2026-109786 activos; puertos `22` y `2241`, `maxretry=5`, `findtime=600` segundos y `bantime=3600` segundos. |
| Exenciones activas | IP de oficina autorizada el 12 de noviembre: `190.210.65.43`; loopbacks `127.0.0.0/8` y `::1`. |
| Origen del journal | Selector efectivo de Debian: `_SYSTEMD_UNIT=ssh.service` **o** `_COMM=sshd`. El 12 de noviembre se comprobaron 300 registros de `sshd-session` dentro de `ssh.service`, cubiertos por el selector de unidad. El filtro reconoce ese nombre de daemon. |
| Prueba de la accion nftables, 12 de noviembre | Ban de la IP documental `192.0.2.254` observado en la jail y el set de `inet f2b-table`, con regla para TCP `22` y `2241`; retirado al finalizar. Su ausencia se reconfirmo el 13 de noviembre. |
| Copia y comprobacion manuales, 12 de noviembre | Backup consistente de diez archivos y comprobacion completa del repositorio, ambos con `exit_code=0` y `stage=complete`. |
| Restauracion y contraste independiente | Restauracion aislada con `exit_code=0`, diez archivos; el 13 de noviembre se compararon de forma independiente por SFTP SHA-256, tamano, modo, UID y GID de los diez contra el catalogo del snapshot. Directorio de ejecucion propiedad de root y modo `0700`. |

El snapshot manual restaurado es
`bae1eed15c0afe62140f59f668880b914eb9d969b1875393c1f939ca5eb8ac3f`.
La evidencia permanece en
`/var/lib/redunisol-foundation/restore-local-config/run.QJKFRQ/evidence.json`, y
los archivos en el subdirectorio `files` de esa ejecucion. El catalogo tiene
SHA-256 `83304023f16892400e358d033b6dd174968ddb7b6520032d015212d50afffd98` y
revision de origen y controlador `6ddeab3310e83517f89fea4592302ca38d3db67a`.
El alcance comprobado es `real-local-foundation-config`, repositorio `local` y
`offsite=false`; incluye la jail y el override del filtro. No acredita una
restauracion de datos de aplicaciones ni una copia fuera del dedicado. La prueba
del ban confirma la ejecucion de la accion y sus reglas, no un ensayo de trafico
de extremo a extremo.

El origen de la sesion SSH observada el 13 de noviembre fue `200.61.165.132`,
distinto de la IP de oficina autorizada y ausente de `ignoreip`. Queda pendiente
confirmar si corresponde a otra red o a un cambio de IP dinamica antes de revisar
esa declaracion. La comprobacion de solo lectura no agrego ese origen ni cambio
la politica del host.

Los reportes locales de soporte estan en
`.local/operations/fail2ban-20261112/restored-independent-20261113.json`,
`verify.json` y `remote_inspect_readonly_20261113-result.json`; son evidencia
operativa local, no archivos versionados ni una fuente de credenciales. Los
reportes corrientes de backup pueden referir a snapshots posteriores al manual
identificado aqui. La entrega de alertas externas y la recuperacion fuera del
host siguen pendientes.

## Puertas de salida

| Puerta | Evidencia requerida |
| --- | --- |
| Revision del cambio | Diff sin secretos; destinos, defaults y opt-ins revisados. |
| Validacion local | Tests de seguridad, YAML/Ansible lint, inventarios parseados y sintaxis de todos los playbooks de la base. |
| Primera aplicacion | Ejecucion autorizada contra el dedicado identificado y verificacion del runtime. |
| Repetibilidad | Segunda aplicacion de provisionamiento con `changed=0`; `--check` no sustituye una aplicacion real. |
| Observabilidad local | Exporter y comprobaciones locales activos, con resultados recientes y verificables. |
| Backup local | Dispositivo y montaje aprobados, copia real, integridad del repositorio y restauracion aislada de configuracion real comparada. |
| Observabilidad externa, diferida | Metricas desde el monitor autorizado y entrega de alertas verificadas; pendiente de conexion. |
| Recuperacion fuera del host | Copia externa identificada y recuperacion real probada; una copia SATA no cierra esta puerta. |

La evidencia local y los pendientes externos se registran por separado. La base
puede estar aplicada y verificada localmente y seguir con aceptacion de proteccion
externa pendiente. Ese pendiente no bloquea preparar futuros despliegues ni
los autoriza automaticamente: cada servicio conserva sus puertas de activacion
y corte. CI no demuestra una aplicacion, una copia ni una recuperacion reales.

## Etapas posteriores

Cada servicio tendra su inventario de dependencias, datos, secretos, revision
desplegada, entradas/salidas, tareas programadas y ventanas de corte. Eso
permitira elegir olas sin separar productores y lectores de archivos compartidos,
habilitar consumidores duplicados ni volver a una base vieja despues de admitir
nuevas escrituras sin reconciliacion. Esas decisiones no se adelantan desde la
configuracion base del host.
