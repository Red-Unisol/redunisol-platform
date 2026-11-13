# MetaMap: preparacion de la migracion al dedicado

## Alcance de este cambio

Este cambio prepara contratos, directorios, configuracion y herramientas de
verificacion para `dedicated_prod_01`. La preparacion no se aplico a ningun host.
No contacta la VPS, copia datos, arranca MetaMap, admite webhooks ni cambia
clientes, publisher, proxy, DNS o el workflow operativo de deploy.

El rol `metamap_server` tiene playbooks propios de preparacion y verificacion.
El destino se selecciona con `metamap_server_hosts`; el grupo de captura
`metamap_migration_origins` queda vacio por defecto.
`metamap_running` solo admite `false`, incluso con autorizacion de escritura.
No hay una opcion de activacion en estos playbooks. La imagen queda vacia hasta
revisar la metadata del runtime; preparar codigo en Git no acredita una imagen
elegida, datos recuperables ni una migracion aplicada.

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
| Herramientas del origen | Linux, cliente Docker con daemon local en `/var/run/docker.sock` y `/usr/bin/python3` compatible con Ansible fijado: Python 3.9-3.14. El Python de la imagen no demuestra el del host. |

La captura incluida soporta SQLite. Si el inventario confirma PostgreSQL, esa
captura debe rechazarlo y el procedimiento consistente de PostgreSQL queda por
definir antes de continuar. El corte conserva motor, esquema e imagen revisada;
no incluye migrar a PostgreSQL ni actualizar versiones de la aplicacion.

El playbook de captura usa modulos Ansible y ejecuta el helper con
`/usr/bin/python3` en el origen. La [matriz de soporte de Ansible 2.21](https://docs.ansible.com/projects/ansible/latest/reference_appendices/release_and_maintenance.html#ansible-core-support-matrix)
exige Python 3.9-3.14 en el host administrado; el helper requiere como minimo
3.9. Si el inventario encuentra solo Python 3.6, la captura queda bloqueada
hasta revisar otra via compatible. Este cambio no instala ni actualiza Python.

## Preparacion del destino

| Variable o ruta | Contrato |
| --- | --- |
| `metamap_prepare_authorized` | `false` por defecto; habilita solo la preparacion expresamente revisada. |
| `metamap_revision` | SHA Git completo de 40 caracteres del checkout revisado. |
| `metamap_running` | Siempre `false`; `true` se rechaza. |
| `metamap_image` | Vacia por defecto; solo admite `ghcr.io/red-unisol/metamap-platform-server@sha256:<64 hex>` tras revisar su metadata. |
| `metamap_prefetch_image` | `false` por defecto; con opt-in descarga esa imagen directamente en el dedicado, sin pasar por la VPS ni iniciar el contenedor. |
| `/srv/redunisol/platform/metamap-server` | Configuracion preparada del servicio. |
| `/srv/redunisol/state/metamap-server/data` | Destino previsto para datos, sin poblacion automatica. |
| `/srv/redunisol/state/metamap-server/updates` | Destino previsto para actualizaciones, sin publicacion automatica. |
| `127.0.0.1:18083:8000` | Binding previsto de loopback; no publica una API ni acredita un listener activo. |

Una preparacion real exige autorizacion, revision y digest revisado. En check
mode puede describirse el plan con la imagen vacia, sin inventar un digest ni
simular que se instalo. Prepare y verify rechazan contenedores existentes del
proyecto, incluso detenidos: no adoptan ni arrancan un runtime previo.

La descarga opcional usa la autenticacion existente del Docker client en el
dedicado. Este cambio no hace `docker login` ni copia credenciales GHCR. Si esa
autenticacion falta, se resuelve por un procedimiento separado con archivos
privados; nunca se pegan tokens en inventarios, argumentos o logs.

Los siguientes comandos se reservan para una preparacion posterior autorizada,
desde el controlador Linux/WSL descrito en la [guia Ansible](../infra/ansible/README.md).
`--check` puede contactar el host; no es una prueba offline:

```bash
cd infra/ansible
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-server-prepare.yml \
  --limit dedicated_prod_01 --check --diff
```

Tras revisar la metadata, el archivo privado de variables fija el SHA, el digest,
`metamap_prepare_authorized: true`, `metamap_running: false` y el opt-in de
prefetch elegido. No se ejecutan estos comandos como parte de este PR:

```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-server-prepare.yml \
  --limit dedicated_prod_01 --extra-vars "@/ruta/privada/metamap-prepare.yml"
ansible-playbook -i inventories/production/hosts.yml playbooks/metamap-server-verify.yml \
  --limit dedicated_prod_01 --extra-vars "@/ruta/privada/metamap-prepare.yml"
```

Verify exige digest, revision y el mismo valor de `metamap_prefetch_image` usado
en prepare: compara tambien esa decision registrada en `preparation.json`.
El ejemplo reutiliza el archivo de variables, aunque verify no requiere
autorizacion de escritura. Comprueba la
preparacion y ausencia de un runtime del proyecto; no prueba salud HTTP de una
aplicacion arrancada. Repetir prepare y registrar convergencia cuando se autorice
aplicarlo, sin convertir verify en una correccion implicita.

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

El origen no se incorpora al inventario operativo de este cambio. Una fase
posterior debe declarar su inventario privado y revisar estas variables:

| Operacion | Variables y guardas |
| --- | --- |
| Captura | `metamap_backup_authorized`, `metamap_revision`, `metamap_writers_stopped_confirmed`; `metamap_source_container`, `metamap_source_image_id`, `metamap_source_data_dir`, `metamap_source_updates_dir`, `metamap_source_expected_hostname`, `metamap_source_expected_machine_id`; `metamap_backup_bundle_dir` nuevo, con padre existente. |
| Restore | `metamap_restore_authorized`, `metamap_revision`, `metamap_restore_bundle_dir` ya presente en el destino, `metamap_bundle_manifest_sha256` revisado y `metamap_restore_directory` nuevo bajo `/srv/redunisol/state/metamap-server/restores/<operation>`. |

Los accesos del inventario privado deben proceder del bloque SSH canonico de
`credentials.txt`; no se copian a esta guia. En una ventana autorizada, desde
`infra/ansible`, el inventario privado debe poblar exclusivamente
`metamap_migration_origins` con el origen revisado. El flujo de playbooks es:

```bash
ansible-playbook -i /ruta/privada/metamap-source.yml playbooks/metamap-server-backup.yml \
  --list-hosts --extra-vars "@/ruta/privada/metamap-capture.yml"
ansible-playbook -i /ruta/privada/metamap-source.yml playbooks/metamap-server-backup.yml \
  --extra-vars "@/ruta/privada/metamap-capture.yml"
```

El helper se envia por stdin; no se instala un script persistente en la VPS.
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

## Corte posterior conservando los clientes

El [actualizador desktop](../apps/metamap-platform/client/transferencias-celesol/src/update.rs)
tiene `BASE_URL` fijo en
`https://kestra.redunisol.com.ar/metamap-platform/updates/transferencias/` y
deshabilita redirects. La API general tiene su propia configuracion de URL;
ambos contratos se inventarian por separado. El primer corte conserva la URL
publica y el HTTPS de la VPS mediante proxy y un enlace privado acotado hacia
el dedicado, cuya configuracion y pruebas se preparan en otra etapa.

El [publisher](../apps/metamap-platform/client/transferencias-celesol/tools/publish_update.py)
escribe hoy en `/srv/redunisol-updates/transferencias`. Al mover el servidor,
debe publicar en el mismo almacenamiento compatible que lea el backend:
binarios inmutables, manifiestos y firmas, y promocion atomica de `latest.json`.
Ese ajuste pertenece al corte del servidor; este PR conserva el publisher y
su workflow actuales. Servir una copia vieja mientras el publisher escribe en
otro root no satisface el contrato.

Conservar la URL a traves de la VPS mantiene el trafico de descarga del EXE por
ella. Reducir ese ancho de banda requiere una etapa **posterior** de cliente y
distribucion. No se cambia codigo ni se distribuye una version desktop ahora.

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
etapas diferentes. En este PR quedan pendientes las operaciones sobre hosts,
el inventario efectivo, los recibos de datos reales y el corte. El rediseño
historico de MetaMap no se toma como evidencia de una arquitectura ya desplegada.
