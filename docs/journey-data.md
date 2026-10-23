# Datos del recorrido web, WhatsApp y CRM

## Contrato y almacenamiento

La web agrega un diario de eventos JSONL, sin tablas SQL para clics ni un job por evento.
El volumen Donweb de 24 GiB se monta por UUID en `/srv/redunisol-tracking`.
Cada ambiente tiene un directorio independiente (`production`, `development`).
Los contenedores PHP, workers y scheduler reciben el mismo bind en `/var/www/journey`;
nginx no recibe los datos. Los archivos quedan fuera del directorio público.

- `events-YYYY-MM-DD.jsonl`: partición por **fecha UTC de recepción**, append only.
- `attribution.sqlite`, `-wal`, `-shm`: referencias y snapshots de atribución, en SQLite WAL.
- `crm-cursors.json`: progreso de cinco streams independientes del CRM.
- `crm.lock`: exclusión del recolector sin locks en la caché SQL.

[JSON Schema v1](../web/redunisol-web/docs/journey-data.schema.json).
Cada registro tiene `schema_version`, `event_id`, `type`, `source`, `environment`,
`occurred_at`, `received_at`, `links` y `data`. Los timestamps del envelope se normalizan a UTC conservando fracciones de segundo; el valor fuente permanece en el registro crudo. No se debe ordenar por nombre de archivo
para inferir el momento del evento: un reintento o una extracción histórica llega después.

## Eventos y alcance

| Evento | Evidencia |
| --- | --- |
| `page.request` | URL/origen observado por el servidor, referer, user agent y estado HTTP |
| `page.view`, `page.leave` | Navegación inicial/Inertia y tiempo transcurrido observado por el navegador |
| `link.click` | Destino de enlaces públicos, incluidos los de WhatsApp |
| `form.step`, `form.validation`, `form.submit`, `form.result` | Pasos, intentos y resultado HTTP del formulario; sin valores de inputs desde el navegador |
| `attribution.created`, `analytics.identity` | Snapshot de adquisición y asociación con IDs GA disponibles |
| `attribution.snapshot` | Estado actual de una referencia, incluida la adquisición heredada; disponible en el inventario de exportación |
| `identity.whatsapp_bound`, `whatsapp.handoff` | Referencia independiente del handoff y asociación verificada con teléfono/subject |
| `form.received`, `form.prequalified` | Datos validados del formulario y decisión de precalificación |
| `form.persistence_result`, `form.persistence_failed`, `form.queue_failed` | Respuesta de Kestra con IDs de ejecución/contacto/lead o fallo de persistencia |
| `whatsapp.kestra_processed` | Acuse de procesamiento Kestra y tipo de mensaje/Flow |
| `whatsapp.job` | Estado de inbox, envío, reconciliación, asistencia, landing y sincronización CRM después de cada intento de job |
| `crm.snapshot` | Ficha cruda modificada de lead, contacto o deal, incluidos campos personalizados |
| `crm.stage` | Transición real del historial de etapas de leads y deals |
| `crm.catalog` | Metadatos de campos de leads/contactos/deals y catálogo de estados |
| `tracking.gap`, `whatsapp.capture_failed` | Pérdida por límite de cola del navegador o fallo de captura de un job |

Los snapshots e historial incrementales del CRM incluyen el contexto comercial compartido,
también registros sin referencia web. Su pertenencia a un recorrido se determina por IDs
explícitos; no todos los registros CRM constituyen conversiones de la web.
El recolector no consulta la base PostgreSQL de Kestra ni crea ejecuciones por navegación.
Los acuses existentes enlazan ejecución, resultado comercial y evento de WhatsApp/formulario.
La evolución comercial posterior se recupera desde Bitrix, fuente primaria de esas etapas.

`links.visitor_id` identifica un navegador por cookie cifrada HttpOnly durante 30 días;
`session_id` se renueva con la actividad recibida (navegación o lote) y dura 30 minutos. Una pestaña abierta puede iniciar otra sesión sin perder el visitante. No prueban identidad personal.
`journey_id` sigue siendo una referencia de atribución/WhatsApp, con múltiples referencias
posibles para un visitante. El handoff conserva `parent_journey_id`; el formulario agrega
un `submission_id` generado por el servidor y los IDs devueltos por Kestra.
`page_id` enlaza el render del servidor, sus eventos de navegador y el formulario.
En vistas sin ID compartido se usa un UUID del navegador; el ID no prueba identidad personal.
`phone_hash` usa la normalización argentina y HMAC con APP_KEY ya vigentes.
Cambiar APP_KEY requiere contemplar la continuidad de cookies, cifrado y hashes existentes.

Se conservan URL de landing, todos los parámetros `utm_*`, click IDs conocidos
(Google, Meta, Microsoft, TikTok, LinkedIn, Snapchat, X, Yandex, Impact y Pinterest),
`_gl`, `gad_*` seleccionados y `ref`. Se excluyen fragmentos, credenciales de URL,
parámetros personales/operativos desconocidos y URLs firmadas de recibos.
Se excluyen las rutas de autenticación y recuperación de contraseña. El colector no agrega
credenciales de configuración, URLs de webhook ni el contenido de archivos subidos.
Los registros y mensajes fuente son crudos y pueden contener información reservada.
El dataset protegido sí contiene datos personales de formularios/CRM y mensajes recibidos.

El navegador es una fuente no confiable: no puede elegir persona, fuente del evento,
IDs CRM ni snapshots del servidor. El contexto de cookies corresponde a la recepción
del lote; los eventos conservan su URL, page_id y hora originales para analizar cambios
de campaña durante un lote. `page.request` es la evidencia del servidor para cada navegación.

## Escrituras y lecturas

- Navegador: lotes cada 10 segundos o hasta 20 eventos, ajustados a 12.000 bytes UTF-8.
  Un solo envío periódico activo; al salir se permiten hasta tres lotes en vuelo acotados,
  con keepalive. Se confirma por ID, incluso si llegan fuera de orden; reintentos con
  los mismos IDs y backoff de hasta 60 s.
  Cola en memoria limitada a 200 eventos. No hay scroll, mousemove ni escritura por tecla.
- Servidor: buffer durante la solicitud y un append al terminar; cada job WhatsApp agrupa
  sus eventos al terminar el intento. No se agregan jobs ni sesiones SQL para la captura.
- Diario: append bajo lock de hasta 50 ms de espera y escritura secuencial. `fflush` entrega
  el lote al kernel; no hace un fsync por clic. El kernel agrupa las escrituras físicas.
- Atribución: SQLite WAL con `synchronous=NORMAL` y busy timeout de 1 segundo. Sólo las
  referencias/snapshots necesitan transacciones, no cada paso o clic. Siguen vigentes las
  validaciones contra referencias inválidas, rebinding y mezcla de identidades GA.
- WhatsApp: hasta dos lecturas por clave primaria por intento de job para conservar el
  resultado operativo, sin escanear tablas ni consultar Bitrix por cada clic.
- CRM: cada cinco minutos, hasta dos páginas de 50 filas por stream, pausa de 250 ms
  entre páginas y presupuesto de 45 s antes de iniciar otra página. Hay cinco streams:
  snapshots de leads/contactos/deals e historial de leads/deals. Se avanza por ID dentro
  de ventanas temporales fijas, con solapamiento de cinco minutos entre ventanas.
  Los catálogos se consultan una vez al día. Si queda backlog se retoma en la próxima tanda.
  Un request ya iniciado puede terminar después del presupuesto (timeout API de 5 s).
- CRM confirma el diario con fsync **por página/lote**, antes de escribir y hacer fsync del checkpoint temporal, que luego se renombra atómicamente;
  un fallo puede repetir registros y nunca autoriza avanzar un cursor por una página fallida.
  El consumidor elimina duplicados por `(environment,event_id)`. Cada registro se limita a
  1 MiB; si uno excede ese límite no se adelanta el cursor de su página.
- Exportación: lee hasta 4 MiB del volumen por pedido. No vuelve a consultar sistemas fuente
  ni genera ZIP/Excel/informes ni una copia completa en el disco principal.

El limiter de nginx usa memoria y desactiva access_log para `/api/journey/events`.
La aplicación mantiene sus colas, sesiones y registros operativos existentes; éstos siguen
teniendo su costo actual. Los IDs de correlación viajan en el job de formulario existente,
sin agregar una segunda cola de tracking. No se cambian configuraciones de PostgreSQL/Kestra.

No se puede garantizar independencia física o ausencia de interferencia entre los discos
virtuales Donweb. Esta implementación reduce volumen de operaciones, fsync y lecturas;
el I/O wait global debe compararse con las métricas propias de cada dispositivo.

## Exportación para Marketing y management

`GET /api/journey/export`, con `Authorization: Bearer <token>`, devuelve manifest:
archivos disponibles, tamaños, esquema, identidad y reserva de espacio.
El bloque `collection` muestra flags, fecha inicial y cursores por stream.
`crm_cursor_status` distingue inicio pendiente, disponible y checkpoint ilegible; un
checkpoint ilegible no impide descargar los eventos ya capturados. Para `crm.stage`,
usar también el ID de historial de la fuente al ordenar transiciones con la misma hora.

Los accesos reales están en `credentials.txt` (`JOURNEY_EXPORT_URL_*`, `JOURNEY_EXPORT_TOKEN_*`).
Nunca poner el token en query strings, notebooks compartidos o prompts de IA.

1. Leer manifest y registrar el tamaño de cada partición.
2. Pedir `?date=YYYY-MM-DD&offset=0` y consumir JSONL UTF-8.
3. Guardar `X-Next-Offset` **después** de persistir el lote en destino.
4. Repetir hasta alcanzar `X-Snapshot-Bytes`. Volver a consultar hoy hasta que cierre.
5. Deduplicar por `(environment,event_id)`, ordenar por hora y cruzar `links`.

No hay acceso público, CORS de exportación, sesión de usuario final ni token frontend.
Rotar el token no modifica los eventos. `?schema=1` devuelve JSON Schema.

`?entity=attribution&after=reference_id` permite recorrer el inventario actual de referencias
en páginas de 200 filas, leyendo sólo SQLite del volumen. Empezar sin `after`, seguir
`X-Next-Id` y terminar cuando `X-Count=0`. Incluye los snapshots heredados que ya se
importaron, con fechas de creación, actualización, vínculo y vencimiento. Es una lectura
del estado actual, no un cursor incremental: las referencias nuevas pueden ordenarse antes
del cursor. Usarlo para la carga inicial o recuperación de orígenes; consumir los archivos
de eventos para la historia incremental posterior.

## Preparación y activación

`deploy/prepare-tracking-volume.sh` valida dispositivo por by-id, serial, tamaño,
firmas, mounts, holders y procesos abiertos. Sólo `--initialize-blank` permite crear ext4
en el dispositivo nuevo vacío esperado. Repetir sin esa opción verifica/prepara el montaje
sin reformatear. Usa UUID, noatime, nodev/nosuid/noexec y permisos de grupo www-data.

Intervención autorizada el 22/10/2026: volumen preparado y montado, UUID
`047f85cf-0e3a-48fe-880f-d42f0ba0be64`, 24 GiB, directorios `production` y `development`.
Este documento y el script son el estado deseado Git de esa intervención.

Los envs cifrados activan JOURNEY_ENABLED, JOURNEY_ENVIRONMENT, JOURNEY_EXPORT_TOKEN
y ATTRIBUTION_DB_CONNECTION=journey. Sólo producción activa JOURNEY_CRM_ENABLED.
Compose expone estas variables a todos los procesos PHP y exige que el bind ya exista.
Los workflows verifican el mount y crean el schema SQLite con la imagen nueva antes
de recrear los servicios. No formatean discos ni migran masivamente datos durante deploy.

Las referencias antiguas se importan de PostgreSQL por lectura puntual al primer uso,
sin sobrescribir filas ya creadas/vinculadas en el volumen. Se preservan los viejos enlaces.
Después del cutover se puede copiar el remanente con `php artisan journey:storage import-attribution`:
lectura de 500 filas, inserts agrupados, pausa de 100 ms, sin borrar la fuente ni sobrescribir
el destino. No ejecutarlo antes de que todos los escritores usen la conexión nueva.
Los snapshots heredados sólo contienen el first/last que existía; no reconstruyen navegación pasada.

Comprobar tras deploy, sin mostrar secretos:

```sh
docker compose exec -T php-fpm php artisan journey:storage status
docker compose exec -T scheduler php artisan journey:crm
```

Validar después un recorrido de prueba: visita etiquetada y otra directa, handoff/Flow,
retorno con ref, formulario y lead/deal; descargar el dataset y comprobar los IDs comunes.
La consulta directa no crea ni modifica fichas CRM. No disparar pruebas sobre personas reales
ni mensajes comerciales para verificar una instalación.

## Capacidad, fallos y reversión

Se detiene el append de eventos cuando quedan menos de 512 MiB. `journey:storage status`
devuelve fallo con menos de 1 GiB; manifest publica los bytes libres. No hay purga automática
del diario: exportar/archivar particiones cerradas y ampliar volumen según crecimiento observado.
Los snapshots de atribución expiran a 30 días; su limpieza no elimina el diario histórico.
No se configura en esta entrega una copia remota ni una alerta externa de espacio.

Si falta el marcador/montaje o el volumen coincide con el filesystem de storage principal,
la captura falla sin escribir en root. El endpoint de lotes devuelve 503 para reintentar;
formularios y WhatsApp continúan con atribución `storage_unavailable`/sin ref cuando corresponda.
Los errores son visibles en logs sin datos ni URLs secretos. Revisar también los cursores CRM
para detectar demora: el timestamp del archivo no prueba que todos los streams estén al día.

El navegador puede bloquear cookies/scripts, cerrar antes del envío o quedar offline.
Su reloj no es autoritativo. Puede perderse la cola local al cerrar y, ante una caída abrupta
de la VPS/almacenamiento, las últimas escrituras web aún en caché del kernel o SQLite NORMAL.
La historia de etapas CRM usa su fuente histórica y se reanuda por cursor; los cambios de otros
campos entre dos snapshots no se presentan como una auditoría exhaustiva de modificaciones.
No se infiere una conversación WhatsApp a partir de un clic: son evidencias distintas.

Para desactivar, cambiar JOURNEY_ENABLED/JOURNEY_CRM_ENABLED en el env cifrado y desplegar.
Para revertir también la conexión de atribución, primero copiar de forma controlada las
referencias nuevas del volumen a PostgreSQL; cambiar sólo la flag perdería su resolución.
Conservar el volumen y las particiones. No desmontar ni borrar datos como parte de un rollback.
Tras reboot verificar mount, bind efectivo y status antes de dar por activa la captura.
