# MetaMap: preparacion de la migracion al dedicado

## Alcance de este cambio

Esta etapa prepara contratos, directorios, configuracion, origen HTTPS y
recuperacion sintetica para `dedicated_prod_01`. La aplicacion operativa sigue
atendida por la VPS. El checkpoint al final distingue lo aplicado de las
operaciones pendientes; preparar el origen no activa MetaMap, copia datos
productivos, cambia clientes o cambia el destino del deploy y del publisher.

El rol `metamap_server` tiene playbooks propios de preparacion y verificacion.
El destino se selecciona con `metamap_server_hosts`; el grupo de captura
`metamap_migration_origins` identifica el origen revisado, con captura y
confirmacion de escritores detenidos desautorizadas por defecto.
`metamap_running` solo admite `false`, incluso con autorizacion de escritura.
No hay una opcion de activacion de la aplicacion en estos playbooks. La imagen
esta fijada por digest tras revisar el runtime; eso no acredita datos
productivos recuperables ni una migracion aplicada.

El nombre historico `metamap-platform-server-dev` corresponde al servicio
operativo. Su [workflow actual](../.github/workflows/deploy-metamap-server-dev.yml)
despliega desde `main` sobre `/opt/metamap-platform-server-dev`; este cambio no
lo modifica. El [README del servidor](../apps/metamap-platform/server/README.md)
describe sus contratos actuales. Las observaciones de codigo siguientes no
sustituyen comprobar el estado efectivo del host en una etapa autorizada.

## Unidad de migracion e inventario pendiente

Backend, datos y actualizaciones deben conservar un unico estado compatible.
El [Compose vigente](../apps/metamap-platform/server/deploy/docker-compose.vps.yml)
monta un volumen en `/data` y `/srv/redunisol-updates` en `/updates:ro`.
La imagen OCI contiene codigo y dependencias, no esos volumenes.

Antes de elegir la imagen o una ventana, completar un inventario por servicio:

| Dato | Evidencia requerida |
| --- | --- |
| Imagen efectiva | Referencia del contenedor, Docker image ID, digest GHCR, plataforma y revision de codigo; demostrar que corresponde al runtime elegido. Un tag `dev-latest` no fija ese contenido. |
| Base real | Motor efectivo de `METAMAP_SERVER_DATABASE_URL`, sin publicar credenciales; confirmar SQLite y su ruta absoluta o PostgreSQL y su ubicacion. Los ejemplos y defaults no demuestran el motor en uso. |
| Datos | Roots reales y montajes de `/data`; bytes, archivos, permisos, propietarios y componentes SQLite WAL/journal presentes. |
| Actualizaciones | Root real de `/updates`, tamanos, versiones, manifiestos firmados, binarios y el publisher que escribe alli. |
| Escritores | Backend, workers de enriquecimiento, otros contenedores con mounts compartidos, procesos del host, jobs y publicacion de actualizaciones. |
| Trabajo pendiente | Cantidad y recuperabilidad de enriquecimientos pendientes; reconciliacion de eventos y trazas durante la pausa. |
| Receipts | Retencion efectiva y cobertura del snapshot. El servidor documenta siete dias y limpieza al iniciar; migrar no recupera receipts ya eliminados. |
| HTTP y clientes | URLs, prefijos, autenticacion, timeouts, consumidores, productor de webhooks y comportamiento de reintento observado. |
| Recuperacion | Ventana, responsables, presupuesto de transferencia, retencion de origen y destino, copia cifrada recuperable y ensayo de restore. |
| Herramientas del origen | Linux, cliente Docker con daemon local en `/var/run/docker.sock` y `/usr/bin/python3` 3.6 o posterior. La captura no usa modulos remotos del Ansible moderno. |

La captura incluida soporta SQLite. Si el inventario confirma PostgreSQL, esa
captura debe rechazarlo y el procedimiento consistente de PostgreSQL queda por
definir antes de continuar. El corte conserva motor, esquema e imagen revisada;
no incluye migrar a PostgreSQL ni actualizar versiones de la aplicacion.

El origen observado usa Python 3.6.8 y SQLite 3.26.0. El playbook de captura
usa `gather_facts: false`, validaciones del controlador y `raw` para ejecutar
el helper compatible con 3.6, comprobar hostname, machine-id e interprete.
No instala ni actualiza Python. Prepare, verify y restore del dedicado usan
los modulos Ansible habituales sobre su Python 3.13. El controlador sigue la
[matriz de soporte de Ansible 2.21](https://docs.ansible.com/projects/ansible/latest/reference_appendices/release_and_maintenance.html#ansible-core-support-matrix).

El 13/11 se observaron la imagen de codigo `a86be2de266029cd1ec4479b8bdfb7f74378e943`,
el Docker image ID `sha256:1c664fb180bd1c4de6ace104b6b305897a5cec8dcd670579a19d8ad42338b4f7`
y el digest GHCR fijado en el inventario. Los datos estan en el volumen
`metamap-platform-server-dev_metamap_platform_server_data` (SQLite de unos
185 MB, mas WAL), y `/srv/redunisol-updates` contiene unos 83 MB de archivos.
Son mediciones parciales: antes del corte volver a relevar cambios y escritores.

## Preparacion del destino

| Variable o ruta | Contrato |
| --- | --- |
| `metamap_prepare_authorized` | `false` por defecto; habilita solo la preparacion expresamente revisada. |
| `metamap_revision` | SHA Git completo de 40 caracteres del checkout revisado. |
| `metamap_running` | Siempre `false`; `true` se rechaza. |
| `metamap_image` | Default del rol vacio; produccion fija el digest revisado `ghcr.io/red-unisol/metamap-platform-server@sha256:f7ecf3631daf2ee5dddf7a4f1772ef6fd71fa0eb00c43add4152de4d7f7b54a5`. |
| `metamap_prefetch_image` | `false` por defecto; con opt-in descarga esa imagen directamente en el dedicado, sin pasar por la VPS ni iniciar el contenedor. |
| `/srv/redunisol/platform/metamap-server` | Configuracion preparada del servicio. |
| `/srv/redunisol/state/metamap-server/data` | Destino previsto para datos, sin poblacion automatica. |
| `/srv/redunisol/state/metamap-server/updates` | Destino previsto para actualizaciones, sin publicacion automatica. |
| `127.0.0.1:18083:8000` | Binding previsto de loopback; no publica una API ni acredita un listener activo. |

Una preparacion real exige autorizacion, revision y digest revisado. En check
mode puede describirse el plan con la imagen vacia, sin inventar un digest ni
simular que se instalo. Prepare y verify rechazan contenedores existentes del
proyecto, incluso detenidos: no adoptan ni arrancan un runtime previo.

`metamap_stage_runtime_env` permite custodiar una copia de los valores actuales
en `/etc/redunisol-metamap/runtime.env.pending`, root `0600`, con padre `0700`.
Su origen es un archivo privado del controlador, nunca valores en Git, argumentos
o logs. Esta copia **no** se llama `runtime.env` ni esta referenciada por Compose.
El futuro `runtime.env` sigue siendo requerido y ausente. Compose usa `format: raw`
para conservar literalmente dolares y comillas de los valores existentes;
la preparacion no los carga ni arranca la aplicacion.

La descarga opcional usa por defecto la autenticacion existente del Docker
client en el dedicado. Si falta, `metamap_registry_auth_file` admite un JSON
privado del controlador con exclusivamente `auths.ghcr.io.auth`, sin otros
registries ni credential helpers. Solo se lee cuando falta la imagen: se copia
a un directorio transitorio `0700` bajo `/run`, con archivo `0600`, y Docker usa
`--config` para ese pull por digest. La limpieza `always` elimina esa copia aun
si falla la descarga; no se hace `docker login` ni se modifica `/root/.docker`.
El acceso se obtiene del indice canonico privado y nunca se incluye en Git,
argumentos, recibos o logs. Eliminar tambien la copia transitoria del controlador
tras la descarga; repetir con la imagen presente no necesita leerla.

Los siguientes comandos se reservan para una preparacion posterior autorizada,
desde el controlador Linux/WSL descrito en la [guia Ansible](../infra/ansible/README.md).
`--check` puede contactar el host; no es una prueba offline:

```bash
cd infra/ansible
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-server-prepare.yml \
  --limit dedicated_prod_01 --check --diff --extra-vars "@/ruta/privada/metamap-prepare.yml"
```

Tras revisar la metadata, el archivo privado de variables fija el SHA, el digest,
`metamap_prepare_authorized: true`, `metamap_running: false` y el opt-in de
prefetch elegido. La aplicacion exige la autorizacion operativa de esta etapa:

```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-server-prepare.yml \
  --limit dedicated_prod_01 --extra-vars "@/ruta/privada/metamap-prepare.yml"
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-server-verify.yml \
  --limit dedicated_prod_01 --extra-vars "@/ruta/privada/metamap-prepare.yml"
```

Verify exige digest, revision y el mismo valor de `metamap_prefetch_image` usado
en prepare: compara tambien esa decision registrada en `preparation.json`.
Si se selecciono staging privado, usar tambien sus mismas variables y archivo
fuente privado: verify compara los bytes sin exponerlos ni cargar el runtime.
El ejemplo reutiliza el archivo de variables, aunque verify no requiere
autorizacion de escritura. Comprueba la
preparacion y ausencia de un runtime del proyecto; no prueba salud HTTP de una
aplicacion arrancada. Repetir prepare y registrar convergencia cuando se autorice
aplicarlo, sin convertir verify en una correccion implicita.

## Origen HTTPS y ensayo de recuperacion

El rol `metamap_origin` usa el Apache ya instalado, con configuracion, PID,
logs y unidad `metamap-origin.service` propios. No altera ni recarga la unidad
`apache2.service` de foundation. La verificacion de foundation identifica su
propio MainPID para no confundir ambos servicios.

El origen nuevo es `metamap-origin.redunisol.com.ar`, con certificado Origin CA
de Cloudflare limitado a ese hostname y vigencia de un ano. La clave se genera
y custodia fuera del dedicado; se entrega mediante archivos privados, nunca
inventarios Git. Su CA se verifica explicitamente en los ensayos directos; los
navegadores deben entrar por el registro proxied de Cloudflare. El recurso
DNS y la huella publica estan descritos en
[`infra/cloudflare/metamap-origin.yml`](../infra/cloudflare/metamap-origin.yml).
No se cambia el registro de `kestra.redunisol.com.ar` ni se configura un Worker
o una ruta productiva en esta etapa.

El primer ensayo usa `127.0.0.1:18443`; la preparacion publica autorizada usa
`168.197.51.104:443`. `GET /health` informa solo transporte HTTPS y backend
deshabilitado. Todo `/metamap-platform` devuelve **503 sin Location**, hasta un
corte separado: no acepta webhooks, sirve una base vacia ni ejecuta un clon.
El contrato rechaza `metamap_origin_backend_enabled: true` en esta etapa.

La configuracion aislada se valida antes de arrancar. La aplicacion compara
tambien la huella servida para reconciliar una recarga perdida tras un fallo;
verify no repara ni recarga. La prueba local de proxy usa un backend HTTP
sintetico, no la base ni las credenciales de MetaMap. Conserva cuerpo, cabeceras,
prefijo y respuestas Range sin redirects al cliente.

El rol `metamap_backup` inicializa un repositorio Restic **independiente** en
`/srv/redunisol-backups/restic/metamap`, con clave distinta, retenida fuera del
dedicado. Comprueba UUID del montaje, ausencia de fallback a `/`, privacidad y
propiedad de la clave; no adopta repositorios desconocidos ni reemplaza claves.
No toca las copias de foundation/BCRA.

El ensayo usa solo un dataset sintetico privado con SQLite y archivos ficticios:
backup cifrado, rechazo de clave incorrecta, `check --read-data`, restore nuevo
y comparacion de hashes/metadatos/SQL. Repetir la preparacion valida la prueba
existente, sin crear snapshots ni renovar su fecha; verify solo lee. La politica
de retencion queda documentada, sin activar timers ni ejecutar prune/forget.
El recibo declara expresamente `production_data_protected: false`, `offsite:
false` y `continuous_backup: false`. La copia productiva, la retencion aplicada
y la cobertura fuera del dedicado siguen siendo requisitos antes de activar.

Los playbooks se ejecutan por separado, con claves y autorizaciones en archivos
privados del controlador. Los grupos de destino seleccionan solo el dedicado:

```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-origin-prepare.yml \
  --limit dedicated_prod_01 --extra-vars "@/ruta/privada/metamap-origin.yml"
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-origin-verify.yml \
  --limit dedicated_prod_01 --extra-vars "@/ruta/privada/metamap-origin.yml"
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-backup-prepare.yml \
  --limit dedicated_prod_01 --extra-vars "@/ruta/privada/metamap-backup.yml"
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-backup-verify.yml \
  --limit dedicated_prod_01 --extra-vars "@/ruta/privada/metamap-backup-verify.yml"
```

Tras preparar origen y repositorio, `metamap-monitoring-prepare.yml` agrega la
unidad nueva a la comprobacion local existente de salud cada 60 segundos. El
exporter conserva el bind privado; la conexion con monitoreo externo sigue
pendiente. La expiracion del certificado y el estado de preparacion se exponen
como textfiles, sin declarar un backend activo ni proteccion de datos productivos.

## Captura fria y restauracion aislada

El playbook `metamap-server-backup.yml` genera una captura privada de transferencia.
Aunque su nombre incluya `backup`, no implementa un respaldo continuo, cifrado
ni externo. El directorio generado no acredita proteccion de produccion. Antes
de activar el servicio se exige una copia recuperable cifrada, por ejemplo una
incorporacion especifica a Restic, con politica, retencion y ensayo de restore.
El SATA de la base sigue siendo una copia local al mismo dedicado.

El helper [`metamap-state.py`](../infra/ansible/roles/metamap_server/files/metamap-state.py)
expone `snapshot`, `verify` y `restore`. La captura exige confirmar la quietud de
**todos** los escritores y comprueba mediante lecturas Docker el contenedor
detenido, imagen efectiva y mounts, antes y despues. Rechaza otros contenedores
activos que compartan los roots. Esa inspeccion no demuestra por si sola que un
publisher, proceso del host o productor externo este pausado: la confirmacion
operativa de quietud sigue siendo obligatoria.

La captura conserva juntos `data` y `updates`, con manifiesto de hashes,
tamanos, modos, UID y GID. Rechaza enlaces y archivos especiales. Valida SQLite
abriendo una copia temporal normal que permite recuperar WAL/journal; conserva
inalterados el origen y el bundle. El recibo se emite solo tras completar las
comprobaciones. El hash esperado del manifiesto se conserva por un canal
confiable separado del bundle; calcular otro hash de una copia recibida no
demuestra que coincida con el origen aprobado.

El origen se declara en un grupo aislado y revisado; las operaciones de captura
siguen necesitando autorizacion propia y estas variables:

| Operacion | Variables y guardas |
| --- | --- |
| Captura | `metamap_backup_authorized`, `metamap_revision`, `metamap_writers_stopped_confirmed`; `metamap_source_container`, `metamap_source_image_id`, `metamap_source_data_dir`, `metamap_source_updates_dir`, `metamap_source_expected_hostname`, `metamap_source_expected_machine_id`; `metamap_backup_bundle_dir` nuevo, con padre existente. |
| Restore | `metamap_restore_authorized`, `metamap_revision`, `metamap_restore_bundle_dir` ya presente en el destino, `metamap_bundle_manifest_sha256` revisado y `metamap_restore_directory` nuevo bajo `/srv/redunisol/state/metamap-server/restores/<operation>`. |

Los accesos privados deben proceder del bloque SSH canonico de `credentials.txt`;
no se copian a esta guia. En una ventana autorizada, desde `infra/ansible`,
revisar exclusivamente `metamap_migration_origins` y las variables privadas de
captura. El flujo de playbooks es:

```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-server-backup.yml \
  --list-hosts --extra-vars "@/ruta/privada/metamap-capture.yml"
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-server-backup.yml \
  --extra-vars "@/ruta/privada/metamap-capture.yml"
```

El helper se envia codificado en la invocacion `raw`; no se instala un script
persistente ni se ejecutan modulos Ansible Python modernos en la VPS.
El playbook no transfiere el bundle entre hosts. La copia posterior debe ser
acotada, reanudable y con limite de ancho de banda, dentro de la ventana acordada;
validar el manifiesto y retener el origen frio. No ejecutar una copia masiva o
un rsync con borrado implicito durante la preparacion.

Una vez presente y verificado el bundle en el dedicado, el ensayo autorizado es:

```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-server-restore.yml \
  --limit dedicated_prod_01 --extra-vars "@/ruta/privada/metamap-restore.yml"
```

Restore crea un directorio aislado nuevo `0700`, con padre existente y canonico;
no sobrescribe datos activos ni instala el dataset en los roots del servicio.
Registrar revision, imagen, hash del manifiesto, resultado SQLite, archivos
comparados y recibos de captura/restauracion sin incluir secretos o payloads.
El ensayo no arranca el backend ni acredita una activacion.

## Ensayo paralelo de webhooks

El ensayo usa el [Worker y su configuracion](../infra/cloudflare/metamap-shadow/README.md)
y el rol `metamap_shadow`, separados de la preparacion del backend productivo.
La VPS sigue siendo la autoridad y conserva su respuesta HTTP original. Solo
los POST firmados al pathname exacto `/metamap-platform/api/v1/metamap/webhooks`
se copian; las consultas del cliente y el updater mantienen su recorrido.

El Worker inicia `fetch(request)` del original antes de procesar la copia.
Conserva URL, query, bytes, cabeceras y respuesta del principal. El trabajo de
copia usa `ctx.waitUntil`: valida HMAC sobre los bytes originales, calcula su
SHA256 y envia a Queues un sobre con UUID, cuerpo base64 y status del principal.
La query y las cabeceras arbitrarias no se guardan en la cola. Un fallo de
copia no sustituye ni cambia la respuesta de la VPS.

El receptor corre la imagen ya fijada, con el handler MetaMap original y una
base **nueva y aislada**. El adaptador acepta exclusivamente sobres autenticados;
no publica las APIs de clientes. No tiene OAuth, API token de MetaMap, bootstrap
de clientes ni recuperacion de enriquecimientos. Usa `network_mode: none`, sin
puertos publicados ni acceso de red. Apache entrega las copias mediante el
socket Unix `/run/redunisol-metamap-shadow/receiver.sock`; su directorio limita
el acceso al usuario del receptor y al grupo de Apache. `systemd-tmpfiles`
recrea ese directorio al arrancar. Apache permite unicamente POST a
`/metamap-shadow/deliveries`, manteniendo `/metamap-platform` en 503.

La proyeccion SQL original, el receipt y el ledger de entregas se confirman en
una sola transaccion. Un reintento de Queues conserva el UUID y no incrementa
otra vez el contador de eventos. Dos llamados originales distintos conservan
sus dos entregas aunque el contenido coincida; no se deduplican por hash.
Si el handler rechaza un payload firmado con 4xx, el rechazo queda registrado
y el ACK del transporte incluye ese status. Un fallo 5xx revierte la transaccion
completa y admite retry. La respuesta de ACK no contiene payloads ni credenciales.

Workers y ambas colas usan el plan Free. El sobre admite hasta 40.000 bytes de
cuerpo, acotados por debajo de un bloque facturable de Queues con su envoltorio.
El consumidor usa timeout de ocho segundos, tres reintentos y una DLQ separada.
La retencion de las colas gratuitas es de **24 horas**. La copia anterior al
acuse de Queues sigue siendo de mejor esfuerzo; no se promete ausencia de
perdidas ni orden global. Hay logs sanitizados de encolado, entregas y fallos.

El estado inicial de despliegue tiene captura apagada, sin rutas y sin dominio
`workers.dev`. Antes de activar la ruta se exige: pruebas locales, prepare y
verify del dedicado, ensayo sintetico por la cola sin escribir en la VPS,
observacion del modo fail-open de la ruta y lecturas de salud de produccion.
El modo fail-open evita depender del Worker al agotar su cupo diario; no es
una garantia contra cualquier falla del programa o de Cloudflare.

La comparacion operativa cuenta entregas y hashes de los bytes por una cohorte
nueva. No compara bases completas, marcas de revision hechas por clientes,
IDs SQL locales ni timestamps de recepcion. El enriquecimiento externo sigue
deshabilitado en el ensayo, por lo que sus campos derivados no acreditan paridad.
Los controles `/health` y `/stats` se leen solo por el socket local; comprueban SQLite
y exponen contadores agregados sin payloads. La recomendacion de ensayo de siete
dias es operativa: **no hay limpieza automatica de la base sombra**. El backup
Restic sintetico de la preparacion anterior no protege esta base.

El rollback retira solamente la ruta del Worker y detiene el proyecto sombra
mediante su playbook autorizado, conservando los datos. No exige cambiar URLs,
configuracion de MetaMap ni datos de la VPS. El estado efectivo y las pruebas de
aplicacion se registran despues del despliegue; este procedimiento por si solo
no demuestra que la duplicacion este activa.

## Corte posterior conservando los clientes

El [actualizador desktop](../apps/metamap-platform/client/transferencias-celesol/src/update.rs)
tiene `BASE_URL` fijo en
`https://kestra.redunisol.com.ar/metamap-platform/updates/transferencias/` y
deshabilita redirects. La API general tiene su propia configuracion de URL;
ambos contratos se inventarian por separado. El corte conserva la URL publica:
puede usar un proxy VPS con enlace privado o el enrutamiento directo desde
Cloudflare al origen nuevo. La seleccion, configuracion y pruebas del trafico
productivo corresponden a la siguiente etapa.

El [publisher](../apps/metamap-platform/client/transferencias-celesol/tools/publish_update.py)
escribe hoy en `/srv/redunisol-updates/transferencias`. Al mover el servidor,
debe publicar en el mismo almacenamiento compatible que lea el backend:
binarios inmutables, manifiestos y firmas, y promocion atomica de `latest.json`.
Ese ajuste pertenece al corte del servidor; este PR conserva el publisher y
su workflow actuales. Servir una copia vieja mientras el publisher escribe en
otro root no satisface el contrato.

Conservar la URL a traves de la VPS mantiene el trafico de descarga del EXE por
ella. Otra alternativa es enrutar internamente `/metamap-platform/*` desde
Cloudflare al nuevo origen: conserva la URL y evita ese salto sin actualizar
el cliente ni emitir redirects HTTP. Elegir y probar esa ruta corresponde a
la etapa de enrutamiento, posterior a esta preparacion. No se cambia codigo
ni se distribuye una version desktop ahora.

El primer arranque tampoco es una prueba inocua: `create_app` inicializa SQL,
bootstrap de clientes y limpieza de receipts; su lifespan recupera trabajo de
enriquecimiento. No iniciar un clon de produccion con secretos y egress hacia
MetaMap. Un ensayo que ejecute codigo necesita datos aislados, credenciales de
prueba y egreso controlado; la preparacion actual no inicia ese clon.

## Puertas antes de admitir escrituras

1. **Inventario y captura:** confirmar motor, digest, roots, tamanos, permisos y
   todos los escritores; acordar ventana dentro de la retencion necesaria.
2. **Ingreso durable:** validar los reintentos reales de MetaMap y los clientes
   ante la respuesta HTTP elegida. Durante la captura no admitir webhooks ni
   nuevas escrituras si no existe una cola durable anterior al servidor. Si no
   esta probada esa durabilidad o el retry upstream, resolver la pausa y la
   reconciliacion antes del corte; no prometer perdida cero.
3. **Una sola autoridad:** detener y confirmar quietud de backend, workers y
   publisher; capturar ambos roots juntos. Mantener el origen frio mientras se
   verifica la transferencia reanudable y la restauracion aislada.
4. **Recuperacion:** contar con copia cifrada recuperable, retencion y restore
   aprobados del dataset real. La captura temporal y el backup de diez archivos
   de configuracion foundation no cubren los datos MetaMap.
5. **Contratos de red:** preparar y probar proxy HTTPS, prefijos, autenticacion,
   enlace privado, health, rechazo sin credenciales y consultas autenticadas.
   Usar archivos privados para la autenticacion de pruebas, sin secretos en
   argumentos ni logs. Probar actualizaciones y firmas con el cliente existente.
6. **Activacion separada:** autorizar un procedimiento de arranque y corte que
   no existe en estos playbooks; conservar digest/motor y decidir como recuperar
   enriquecimientos pendientes sin ejecutar dos escritores.
7. **Observacion y vuelta atras:** registrar primeras escrituras, trabajo
   pendiente, receipts y entregas del publisher. Tras nuevas escrituras en el
   dedicado, volver al estado viejo puede perder datos: detener escritores y
   reconciliar SQL, archivos y publicaciones antes de una vuelta atras.

La preparacion, migracion de datos, copia cifrada, activacion y sus recibos son
etapas diferentes. Quedan pendientes completar el inventario de escritores,
los recibos de datos reales y el corte. El rediseño historico de MetaMap no se
toma como evidencia de una arquitectura ya desplegada.

## Checkpoint de preparacion: 13 de noviembre de 2026

Este registro es evidencia fechada, no un indicador de salud actual.

| Componente | Evidencia y estado |
| --- | --- |
| VPS operativa | Se observaron imagen, mounts, SQLite y Python indicados arriba. MetaMap sigue atendido por el contenedor existente; esta preparacion no lo detuvo ni recreo. |
| Dedicado | Debian 13, Python 3.13.5, Docker 29.9.3, Compose 5.7.0, Apache 2.4.69 y Restic 0.18.0. Origen independiente aplicado primero en loopback `18443` y luego en `168.197.51.104:443`; repositorio foundation y BCRA existentes conservados. |
| Compatibilidad del origen | Compilacion/importacion del helper y ayuda de captura ejecutadas en Python 3.6.8/SQLite 3.26.0 reales; no se capturaron datos ni instalaron herramientas en la VPS. |
| Servicio preparado | Directorios, Compose cerrado y `runtime.env.pending` instalados; imagen por digest descargada directamente desde GHCR. No hay contenedor MetaMap ni listener `18083`; `runtime.env` sigue ausente y los directorios productivos siguen vacios. |
| Autenticacion de descarga | La credencial existente de la VPS fue rechazada por GHCR; se valido un acceso nuevo con solo `read:packages`. Se uso configuracion transitoria y se elimino tambien su copia del controlador. No se guardo el token en Docker. |
| Contratos Ansible | Check mode de servicio/origen/backup en el dedicado y captura en la VPS sin cambios ni errores. Posteriormente se aplicaron las preparaciones autorizadas; no se ejecuto captura, transferencia o restore de datos productivos. |
| Certificado nuevo | Origin CA instalado para `metamap-origin.redunisol.com.ar`, con vencimiento `2027-11-13T15:59:00Z`; SAN, correspondencia con clave e issuer verificados. Clave root `0600` en el dedicado y bajo custodia privada del operador. |
| Secretos preparados | Configuracion actual custodiada en `runtime.env.pending` root `0600`, fuera del proyecto Compose; nueva clave Restic independiente instalada. Ninguna configuracion operativa cargada en un contenedor MetaMap. |
| HTTPS y Cloudflare | A proxied al dedicado y regla Strict limitada al hostname nuevo aplicados. Lectura de UI confirma IP, proxy y Strict; HTTPS publico normal confirma `/health=200`, backend deshabilitado y rutas de aplicacion `503` sin Location. Registro `kestra` y rutas productivas existentes conservados. |
| Recuperacion sintetica | Repositorio Restic MetaMap independiente inicializado en el SATA; backup cifrado, rechazo de clave incorrecta, `check --read-data`, restore y hashes/metadatos/SQL correctos. Repeticion `changed=0` conserva snapshot y fecha; verify independiente `changed=0`. No protege datos productivos. |
| Observabilidad local | Origen agregado al collector existente; exporter en loopback. Verificacion de proxy foundation y monitoreo local `changed=0`, con salud fresca y servicio nuevo activo. La conexion externa y sus alertas siguen pendientes. |
| Pruebas locales | Base de 314 pruebas sin omisiones con Apache HTTPS y Restic reales; modulo de preparacion actualizado: 27 pruebas aprobadas, incluidas cinco de auth transitoria (319 pruebas distintas en total). YAML estricto, ambos inventarios, sintaxis de 24 playbooks y lint sin fallos ni avisos; lint/YAML focalizados repetidos para el ajuste de auth. Compose validado sin daemon, con valores sinteticos para dolares/comillas. |

La preparacion del servicio usa revision
`0cc65629c1b25ab4cd35ed69f5227cfd6b100ff7`, que incorpora auth transitoria.
Origen, ensayo Restic y monitoreo se aplicaron con el codigo revisado en
`4efe4f60b4e3ef52dadc790471affec200aefaec`; no se reinterpretan como si ya
estuvieran aplicados desde un commit posterior de documentacion. El origen
repetido termino `changed=0`, con verificacion independiente `changed=0`.
El recibo sintetico conserva snapshot
`07d81499cc8ea222ad9cebc7eeee552499dd38acac6c791019019dee1b1f264f`.
La preparacion del servicio repetida, con el archivo de autenticacion temporal
del controlador ya eliminado, y su verify independiente terminaron `changed=0`.
La comprobacion del contenido OCI verifico los hashes del indice fijado, su
manifiesto `linux/amd64` y el config digest `sha256:1c664fb180bd1c4de6ace104b6b305897a5cec8dcd670579a19d8ad42338b4f7`
observado en la VPS; no dependio de comparar solamente los Image ID que muestran
los distintos almacenes Docker.

La comprobacion publica de produccion mantuvo salud `200`, consultas autenticadas
`200`, rechazo sin credenciales `401` y manifiesto del updater `200`, conservando
la revision de aplicacion `a86be2de266029cd1ec4479b8bdfb7f74378e943`.
La lectura de preservacion en el dedicado confirmo BCRA healthy, sin reinicios,
con su revision aplicada anterior y `/health=200`; `/root/.docker/config.json`
continua ausente y no quedan directorios `/run/metamap-ghcr-*`.
En la ultima lectura del origen se localizaron el mismo contenedor `bae9aaa...`
y salud directa `3031=200`. La inspeccion final de nombre, imagen, reinicios y
bindings no se completo: dos conexiones SSH acotadas agotaron el tiempo antes
de ejecutar comandos. No se atribuyo causa ni se intervino. A las 14:10 ART,
la comprobacion publica posterior mantuvo salud/API/updater `200` y rechazo
sin credenciales `401`. Antes de la captura volver a comprobar el acceso SSH
y los campos del inventario en el origen; este checkpoint no los da por
reconfirmados por esa ultima inspeccion parcial.

Siguen pendientes la conexion al monitoreo externo y una copia fuera del
dedicado. Antes del corte tambien faltan la captura y recuperacion del dataset
real, asegurar ingreso durable/reintentos y quietud de escritores, definir el
enrutamiento conservando URLs y adaptar el destino del publisher. Ninguno de
los ensayos sinteticos acredita proteccion de los datos productivos.
