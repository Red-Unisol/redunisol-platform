# Receptor entrante de Edna

Implementación del receptor para la tarea Bitrix 23055. La entrada pública es Laravel en
`/api/webhooks/edna/incoming`. El worker envía el evento al flow
`edna_incoming_webhook` de este dominio. Kestra clasifica; el bridge Laravel
registra y envía el Flow cuando se habilita el router. No crea leads, envía
landings ni reasigna conversaciones en esta etapa.

## Recorrido y contrato

1. Edna verifica la URL mediante `HEAD`: devuelve 200 vacío sin autenticación,
   solamente si el receptor está habilitado y configurado. No genera trabajos.
2. `POST` requiere JSON y la clave de autenticación entrante. Devuelve 401 si no
   coincide; 503 si falta configuración. La clave se compara en tiempo constante.
3. Acepta un objeto individual (ejemplos TEXT de Edna) o un array de hasta 100
   eventos (ejemplos FLOW), con un máximo de 1 MiB. Cada evento usa `id`, `subjectId`,
   `subscriber.identifier`, `receivedAt`, `messageContent.type` y `.text`.
   Cuerpo inválido: 400; tipo de contenido incorrecto: 415; exceso de tamaño: 413.
4. Sólo persiste TEXT/FLOW del `subjectId` configurado. Por elemento, tipos o canales
   ajenos cuentan como `ignored`; envelopes incompletos o textos mayores a 32 KiB
   cuentan como `invalid`. Estos elementos se descartan sin reintentar. La respuesta
   200 incluye `accepted`, `duplicates`, `ignored`, `invalid`; observar esos contadores
   durante la prueba real para detectar diferencias de contrato.
5. Conserva también `replyOutMessageId` y `replyOutMessageExternalRequestId` cuando
   vienen: ID numérico de hasta 64 dígitos y requestId de hasta 256 bytes. Son
   referencias para correlacionar con el envío, no una validación del Flow por sí
   solas. Guarda el envelope mínimo cifrado con `APP_KEY` en `edna_incoming_events` y el
   trabajo en `jobs`, en una misma transacción. La restricción única
   `(subject_id, message_id)` evita reenqueues al repetir el callback. Si falla
   base de datos o cola, revierte el lote y devuelve 503 para que Edna reintente.
6. `edna-worker` usa la conexión database `edna` y cola `edna`, independiente de la
   cola predeterminada. El job contiene sólo el ID interno del inbox. Espera una
   respuesta Kestra con `ok: true`, el mismo `event_key` y un `kind` reconocido;
   un HTTP 200 con sólo un ID de ejecución no cuenta como entrega.

El estado pasa de `pending` a `delivered` cuando Kestra confirma. Hay ocho intentos
con pausas de 10, 30, 60, 120, 300, 600 y 1800 segundos. HTTP tiene timeout de 25 s,
el worker de 45 s y la reserva de cola de 90 s. Al agotar intentos queda `failed`.
Un timeout ambiguo puede producir más de una ejecución Kestra: la entrega es al
menos una vez; el parser actual no tiene efectos externos. Cualquier futura
acción de negocio deberá implementar idempotencia persistente propia.

## Interpretación en Kestra

- TEXT con la frase `vengo del sitio web de Red Unisol`, ignorando mayúsculas y
  espacios repetidos: `router_entry`, `wa_entry=website`.
- FLOW: decodifica JSON de `messageContent.text`, valida `provincia` y el campo
  `situacion_<provincia>` activo. Ignora selecciones de campos ocultos de otras
  provincias. `otra` produce segmento `otra`.
- El artefacto `event.json` contiene identidad del evento, identificador del destinatario, fecha,
  provincia/segmento y `flow_token` si vino. Los mensajes ajenos o inválidos
  producen `null`. El recibo HTTP sólo tiene `ok`, `event_key`, `kind`, `reason`.
- El Flow previsto es `1850162769693486`. El formato de respuesta no acredita ese
  ID: sin correlación el artefacto marca `flow_id_verified=false`. El bridge valida
  canal, destinatario, requestId, ID de mensaje saliente y Flow contra el registro
  persistente y el historial de Edna. Sólo entonces agrega `routerContext`, y Kestra
  confirma `flow_id_verified=true` en el recibo y el artefacto. El intake público
  descarta cualquier contexto aportado por el cliente. Una respuesta no correlacionada
  puede clasificarse, pero no habilita acciones comerciales.

## Configuración y activación posterior

Los ejemplos de entorno dejan esta integración apagada. El receptor no necesita
el token Meta ni la API key de salida de Edna. Usar claves separadas para ambos
saltos y mantenerlas en el circuito local/encriptado de credenciales del repositorio.

| Runtime | Variable | Uso |
|---|---|---|
| Web | `EDNA_INCOMING_ENABLED` | `false` por defecto; habilitar después de preparar Kestra. |
| Web | `EDNA_INCOMING_WEBHOOK_KEY` | Clave que Edna envía al autenticar callbacks. |
| Web | `EDNA_INCOMING_AUTH_HEADER` | `Authorization`; Edna envía `Token <clave>`. |
| Web | `EDNA_INCOMING_SUBJECT_ID` | Canal autorizado; Ventas observado: `2423`. |
| Web | `KESTRA_EDNA_INCOMING_WEBHOOK_URL` | URL HTTPS completa del trigger interno, con su clave. |
| Kestra | `ENV_EDNA_INCOMING_SUBJECT_ID` | Mismo canal autorizado que en web. |
| Kestra | `SECRET_EDNA_INCOMING_WEBHOOK_KEY` | Clave independiente del trigger, en base64 según la convención Kestra. |

El callback real de Ventas del 18/09/2026 confirmó `Authorization: Token <clave>`.
La sonda original sólo distinguía `Bearer` y `Basic`: su etiqueta `raw` no probaba
la ausencia de otros prefijos. La inspección posterior confirmó que el sufijo
coincide exactamente con la clave configurada, sin guardar ni mostrar su valor.
El receptor reconoce `Token` en Authorization y compara la clave en tiempo constante;
conserva compatibilidad con claves sin prefijo y headers personalizados. La sonda
ahora distingue también el formato `token` sin almacenar la credencial.
La clave entrante corresponde a “edna Pulse request authentication” del registro
de webhook, no a “Your API key” usada para llamar a la API de Edna. Configurar sólo
la clave, sin anteponer `Token`, sin decodificarla ni exponerla en logs.

### Evidencia y corte a producción

La prueba del 18/09/2026 verificó en la sonda temporal:

- TEXT del canal Ventas y FLOW con `provincia=cordoba` y
  `situacion_cordoba=jubilado_pensionado`; el parser local produjo `flow_response`.
- La respuesta FLOW incluyó `replyOutMessageExternalRequestId` coincidente con el
  requestId usado para enviar el Flow previsto al mismo destinatario.
- Después de activar autenticación, el mismo marker llegó a Bitrix a las
  10:54:15 ART y a la sonda con `Authorization` a las 10:54:16 ART. Se verificó por
  REST en el chat abierto 104293, sesión 293957. No fue necesario modificar Bitrix.

El 18/09/2026 a las 11:33:52 ART quedó confirmado un FLOW real de Catamarca /
empleado público en el inbox definitivo y Kestra. A las 11:34 también se verificó
un TEXT en ambos destinos, incluido Bitrix. Se retiró la sonda. Esos envíos fueron
pruebas operadas por API, no prueba del nuevo disparador automático.
El cambio de activación configura los entornos cifrados de web prod y Kestra, con
claves distintas para ambos saltos. Al mergear se despliegan web, infraestructura
Kestra y los namespace files del dominio por sus workflows existentes; comprobar
que los tres runtimes aplicaron sus cambios antes de sustituir la URL temporal.
El receptor usa el namespace `redunisol.prod.marketing-crm` y canal `2423`.

El corte consiste en reemplazar **sólo Additional URL** del webhook entrante Ventas
por `https://redunisol.com.ar/api/webhooks/edna/incoming`, conservando URL principal
de Bitrix, autenticación activada y su clave. Antes, probar HEAD 200, POST sin clave
401 y una entrega sintética hasta Kestra con deduplicación. Después del corte,
probar un TEXT y un FLOW reales hasta estado `delivered`, y verificar continuidad
en Bitrix. Retirar y detener la sonda cuando se confirme el circuito definitivo.

La recepción puede permanecer activa con `EDNA_ROUTER_ENABLED=false`. La nueva
etapa de envío y correlación se activa por separado, como se describe abajo.
El envío de la landing y la escritura de datos WA en Bitrix siguen pendientes.

Orden de activación:

1. Desplegar por Git los namespace files y el flow en el ambiente objetivo,
   configurar las dos variables Kestra y recrear su runtime por el workflow de
   infraestructura. El deploy reescribe el namespace a `redunisol.<env>.marketing-crm`.
2. Desplegar web con su migración y `edna-worker`, inicialmente deshabilitado.
   Configurar el entorno web y recrear los servicios por los workflows existentes.
   La URL Kestra sigue `/api/v1/main/executions/webhook/<namespace>/edna_incoming_webhook/<key>`.
3. Habilitar el receptor. Comprobar HEAD 200 sin clave, POST sin clave 401,
   evento sintético autorizado 200 y posterior estado `delivered`; repetir el ID
   y verificar `duplicates=1`. Probar también JSON FLOW y una indisponibilidad de
   Kestra seguida de recuperación. No imprimir credenciales en comandos de prueba.
4. En Edna, editar el webhook entrante existente del canal Ventas y completar
   **Additional URL** con la URL web. Conservar la URL principal de Bitrix y los
   callbacks de estados. No crear otro registro para el mismo canal y evento:
   la UI devuelve `Webhook for this sender already exists`. Edna documenta dos
   URLs, pero eso no confirma si la segunda recibe copia o funciona como respaldo;
   verificar el comportamiento con un envío real en ambos destinos.
5. En una prueba acordada, completar el Flow desde un teléfono de prueba y
   confirmar tanto la continuidad del mensaje en Bitrix como el evento normalizado
   en Kestra. Sólo esa prueba verifica la integración real con Edna. El identificador
   del destinatario se conserva sin asumir que siempre sea un teléfono (Edna también
   documenta BSUID); resolverlo antes de cualquier futura vinculación CRM.

El canal observado de Cobranzas (`2580`) queda fuera del filtro. No apuntar
producción a un namespace dev ni sustituir el callback de Bitrix por este receptor.

## Operación, datos y reversión

### Diagnóstico de autenticación sin soporte externo

Para observar el contrato real, el backend ofrece una sonda temporal independiente
del receptor productivo. Se habilita solamente desde consola:

```sh
php artisan edna:probe start --subject=2423 --minutes=240
php artisan edna:probe show <UUID>
php artisan edna:probe stop <UUID>
```

`start` devuelve `id`, `path`, un texto de prueba `marker` y vencimiento UTC. Usar
el path con el dominio HTTPS del mismo runtime. La duración máxima es cuatro horas.
HEAD devuelve 200 sólo mientras la sonda está activa; GET no permite ver resultados.
Configurar Additional URL en el webhook existente sin reemplazar Bitrix y enviar
exactamente el marker desde el teléfono de prueba al canal autorizado. Conservar
la autenticación actual del registro: cambiarla puede afectar también a Bitrix.

Por defecto, sólo un callback TEXT con ese marker y subjectId actualiza la
observación. Otros eventos con transporte válido se confirman sin guardar datos.
El resultado contiene fecha, nombres de headers y
formatos enumerados (`raw`, `bearer`, `basic`, `token`, `empty`, `multiple`). No guarda valores,
hashes de credenciales, IP, identificadores de clientes ni cuerpo del mensaje; no
encola trabajos ni llama a Kestra. La observación vence junto con la sonda. El cache
puede conservar físicamente entradas expiradas hasta su limpieza habitual, pero
éstas tampoco contienen valores de headers ni conversaciones en el modo predeterminado.

Si llegó un POST pero el filtro no lo reconoce, se puede habilitar explícitamente
la captura ampliada sobre la **misma sonda y URL**, con autorización para conservar
conversaciones:

```sh
php artisan edna:probe capture <UUID> --capture-minutes=15
php artisan edna:probe show <UUID>
php artisan edna:probe show <UUID> --payload
php artisan edna:probe stop <UUID>
```

La captura dura 15 minutos por defecto (entre 1 y 30), sin extender el vencimiento
original de la sonda. Guarda los primeros 20 POST recibidos durante esa ventana,
incluidos eventos sin marker, otros subjectId, envelopes desconocidos, JSON inválido
y cuerpos no JSON. Por eso se debe configurar exclusivamente en el canal bajo prueba.
HEAD no genera capturas. No autentica el origen ni demuestra por sí sola que un
evento venga de Edna.

Conserva hasta 64 KiB del cuerpo de cada POST, cifrados con `APP_KEY`; informa
`body_bytes` y `truncated` cuando excede el límite. No guarda valores de headers,
cookies ni credenciales de autenticación transportadas en headers. El cuerpo sí
puede contener conversaciones e identificadores personales. Registra fecha, nombres
y formatos de headers, `is_json` y el resultado del filtro: `matched`, `no_match`,
`unexpected_envelope`, `invalid_json`, `not_json` o `too_large`. Las respuestas HTTP
del modo predeterminado se conservan (400 para transporte inválido, 200 para eventos
válidos), sin encolar trabajos ni enviar mensajes.

`show` devuelve sólo metadatos; `show --payload` descifra en consola y agrega
`body_base64` para preservar exactamente los bytes, incluso JSON malformado. No hay
endpoint HTTP de lectura. No copiar ese resultado a logs, Git ni comentarios públicos.
`capture_limit_reached` indica que se alcanzaron 20 eventos; los siguientes no se
almacenan. Repetir `capture` no vacía el historial ni amplía ese cupo.

Las capturas quedan consultables hasta que vence la sonda. Al vencer dejan de ser
accesibles por la aplicación; el cache puede conservar físicamente datos cifrados
hasta su limpieza habitual. Ejecutar `stop` al terminar elimina explícitamente las
entradas de configuración, observación y capturas. La ampliación no recupera cuerpos
descartados antes de habilitarla y se mantiene apagada después del despliegue hasta
ejecutar `capture` desde consola.

La sonda no autentica al remitente: ayuda a identificar el header y prefijo durante
una prueba controlada. La confirmación de la clave se hace después contra el receptor
autenticado, con un envío real. Una petición sintética sólo valida la sonda, no Edna.
Guardar la clave nueva por el circuito de credenciales, no en el chat ni en logs.
Al finalizar, retirar el callback temporal en Edna y ejecutar `stop`; no sustituir
el receptor definitivo por esta ruta. No dejar URLs vencidas configuradas en Edna.

### Inbox definitivo

Consultar contadores agrupados por `status`/`outcome` en el inbox y la cola fallida
sin volcar payloads. Para recuperar un trabajo agotado, corregir la configuración
y usar `php artisan queue:retry <uuid>` para el UUID específico de `queue:failed`
cuya conexión sea `edna`; no reintentar todas las colas. Repetir el callback de Edna
no reencola un evento fallido existente. El worker omite eventos ya entregados.

El payload se cifra en la base web; `APP_KEY` debe conservarse mientras haya
eventos pendientes. Los headers entrantes no se guardan ni se reenvían. Los errores
del worker se reemplazan por mensajes sin URL ni payload. Kestra sí almacena el
body del trigger y el artefacto con datos personales: restringir acceso y aplicar
la retención de ejecuciones/storage correspondiente antes de activar.

`php artisan edna:prune --days=30` elimina el payload sólo de eventos entregados
hace más de 30 días, conservando IDs para deduplicar. No modifica pendientes ni
fallidos y no purga Kestra. Es un comando manual; acordar su programación en la
activación. No borrar tombstones como mecanismo de replay.

Para detener la integración, retirar solamente su segundo callback en Edna y
deshabilitar `EDNA_INCOMING_ENABLED`; el worker también deja de entregar. Conservar
la tabla/cola para inspección y recuperación. No hacer rollback destructivo de la
migración con mensajes pendientes. El callback original de Bitrix sigue independiente.

## Referencias

- [Edna: mensajes entrantes](https://docs-pulse.edna.io/docs/api/callback/get-message/)
- [Edna: callbacks adicionales](https://docs-pulse.edna.io/docs/api/callback/callback-set/)
- [Edna: configuración webhook](https://docs-pulse.edna.io/docs/integrations/api/webhook-settings/)
- [Kestra: webhook con wait/returnOutputs](https://kestra.io/plugins/core/trigger/io.kestra.plugin.core.trigger.webhook)
- [Laravel: colas y trabajos fallidos](https://laravel.com/framework/docs/12.x/queues)


## Envío automático y registro persistente

La detección de la frase sigue en Kestra. Después de su confirmación `router_entry`,
Laravel reserva el envío y encola `SendEdnaFlow` en la misma transacción que marca
el inbox entregado. Esta división mantiene la clasificación en Kestra y aprovecha
PostgreSQL/cola existentes para la atomicidad, sin añadir otro almacén.

- `edna_router_contacts` serializa por canal, Flow y destinatario mediante un HMAC
  de su identificador. El destinatario se guarda cifrado en `edna_flow_sends`.
- Un solo envío por persona/canal/Flow en una ventana móvil de 24 horas. Repetir la
  frase, incluso tras completar el formulario o un rechazo, no genera otro envío
  dentro de esa ventana. Un mensaje nuevo después de 24 horas inicia otro ciclo.
- Sólo se reservan entradas posteriores al corte configurado, con teléfono válido,
  antigüedad menor de 23 horas y no más de cinco minutos en el futuro. La demora de
  cola se vuelve a comprobar antes de enviar. Los identificadores BSUID no se
  convierten en teléfonos ni disparan envíos en esta versión.
- La cascada debe estar activa y contener únicamente el canal configurado, sin
  etapas adicionales. Se verifica por API antes de cada envío.
- El worker confirma `sending` en base **antes** del único POST a `cascade/schedule`.
  Un segundo worker, un crash o un reintento nunca repite ese POST para el mismo
  registro. Un timeout/5xx/acuse ambiguo queda `unknown`, no se presume un fracaso.
- Se consulta `messages/history`, buscando el comentario igual al requestId y
  comprobando destinatario, canal, cascada, dirección OUT, tipo FLOW y Flow ID.
  Sólo un resultado único con estado SENT/DELIVERED/READ pasa a `confirmed`.
  La consulta está acotada al intervalo del intento y 1000 registros; resultados
  ambiguos, incompletos o todavía no visibles se reintentan sin enviar mensajes.
- La respuesta debe traer ambos identificadores de reply, corresponder al mismo
  destinatario/canal y llegar dentro de 24 horas del ciclo. Si el historial todavía
  no está confirmado, se reintenta el inbox. La primera respuesta válida queda
  asociada a `response_event_id`; otra respuesta del mismo ciclo se clasifica sin
  confirmarla como nueva respuesta válida. Las respuestas inválidas no consumen el ciclo.
- El contexto verificado y la confirmación de Kestra se guardan antes de completar
  el registro. No se completa si una versión anterior de Kestra omite el acuse
  `flow_id_verified`. Las acciones de landing/CRM usan esta compuerta antes de reservar sus trabajos.

El estado `confirmed` acredita el mensaje saliente observado (SENT o posterior);
`completed` acredita una respuesta correlacionada, **no** una solicitud de crédito
completada ni una landing enviada. No se promete entrega exactamente una vez:
ante una incertidumbre persistente se prioriza no duplicar y se deja revisión operativa.

### Configuración del envío

| Variable web | Uso |
|---|---|
| `EDNA_ROUTER_ENABLED` | `false` por defecto; independiente del receptor entrante. |
| `EDNA_ROUTER_START_AT` | Fecha ISO 8601 con zona horaria del corte; requerida al habilitar. |
| `EDNA_ROUTER_RECIPIENTS` | Teléfonos de prueba separados por coma; vacío permite todos los elegibles. |
| `EDNA_API_KEY` | Credencial de salida de Edna; distinta de la autenticación entrante. |
| `EDNA_ROUTER_CASCADE_ID` | Cascada del canal; Ventas verificada: `2557`. |

El entorno prod cifrado de esta implementación habilita únicamente el número de
prueba autorizado por el operador, con corte `2026-09-18T15:03:17+00:00` y cascada
`2557`. Dev sigue apagado. Ni el número ni la clave de API se publican en esta guía.
La recepción del resto de Ventas continúa, pero no dispara formularios.

El Flow está fijado a `1850162769693486`. Configurar los entornos cifrados y desplegar
mediante Git. El ejemplo queda apagado. Para el piloto usar únicamente números
internos y una fecha de corte reciente. Mantener esa restricción hasta incorporar
la respuesta de landing, las UTMs y los campos WA en Bitrix.

Desplegar primero el parser/YAML de Kestra y luego la aplicación con su migración
aditiva. La versión antigua del bridge funciona con el recibo ampliado. Habilitar
los envíos después de ambas publicaciones; cualquier orden temporal contrario
mantiene las respuestas correlacionadas pendientes de reintento, no las da por completas.

### Operación y validación

`php artisan edna:router status [id]` muestra IDs, estados y motivos, sin teléfonos,
conversaciones ni credenciales. `php artisan edna:router reconcile <id>` vuelve a
consultar el historial; nunca reenvía el Flow. Si una respuesta agotó los reintentos
antes de confirmar el historial, reconciliar primero y luego reintentar su job
fallido por el circuito normal de Laravel. No resetear `sending`/`unknown` a `pending`.

`edna:prune` también limpia destinatarios cifrados de registros cerrados antiguos
(30 días por defecto, mínimo dos para este registro). Conserva IDs/HMAC para
trazabilidad y los casos pendientes/inciertos para diagnóstico.

Validar en el piloto: frase con sufijos, envío único, frase repetida, respuesta
correcta marcada verificada, respuesta ajena rechazada para efectos comerciales,
y continuidad en Bitrix. Las pruebas locales simulan además timeout posterior al
POST, workers intercalados, caída antes de guardar el acuse, historial ambiguo,
respuesta anterior al historial, reversión transaccional, credenciales/configuración
incorrectas y expiración. El piloto del 2026-09-18 verificó entrada automática, respuesta CABA/PFA correlacionada y continuidad del mensaje en Bitrix. La validación real de landing y campos CRM requiere desplegar la siguiente etapa.

Referencias de contrato: [envío por cascada](https://docs-pulse.edna.io/docs/api/messages/sending/)
y [historial de mensajes](https://docs-pulse.edna.io/docs/api/messages/history/).


## Landing y clasificación CRM (tarea 23055)

`EDNA_ROUTER_RESULTS_ENABLED` habilita las dos acciones posteriores a la respuesta
verificada. Prod conserva **sólo el teléfono del piloto**; dev y los ejemplos quedan
apagados. `EDNA_BITRIX_WEBHOOK_URL` reutiliza el acceso CRM canónico, cifrado y
expuesto por Compose a PHP y al worker. No se modifican los callbacks de Edna.

La transacción que completa el Flow reserva un único `edna_router_results` por
Flow/respuesta y encola dos trabajos independientes. No se procesan retroactivamente
respuestas anteriores al despliegue:

- `SendEdnaLanding` revalida piloto, canal, cascada y antigüedad de respuesta menor
  de 23 horas. Envía TEXT y confirma `sending` antes del POST. Timeout, 5xx o acuse
  ambiguo quedan `unknown`; un reintento sólo consulta historial, nunca reenvía.
- `ReconcileEdnaLanding` exige un único saliente con el mismo requestId, destinatario,
  canal, cascada y texto exacto, con estado SENT/DELIVERED/READ.
- `SyncEdnaRouterCrm` prioriza un contacto único por teléfono; si no existe, admite
  un lead único y activo. Nunca crea contactos, leads ni negocios. Coincidencias
  múltiples o teléfono cambiado quedan `review`. Ausencia de registro se reintenta
  para tolerar el retraso del callback primario de Bitrix; al agotarse queda `failed`.
- El destino CRM se fija durablemente antes de actualizarlo. Los ciclos del mismo
  número se serializan y un WA_TIMESTAMP posterior deja el resultado `superseded`.
  La comparación previa y la relectura posterior permiten resolver un timeout de
  actualización sin repetirla. Un fallo del CRM no bloquea ni reenvía la landing.

### Destinos y tracking

El mapa versionado está en `app/Services/EdnaLandingRoute.php` dentro de la app web.
Contiene los 15 pares válidos de provincia/situación de la tarea:

- Córdoba: Jubilados, Empleados Públicos, Policía, Docentes, Salud y UNC tienen sus
  landings específicas; `otra` va a Home.
- Catamarca: empleado público, policía, docente y salud comparten la landing
  `/prestamos-para-empleados-publicos/empleados-publicos-catamarca`; `otra` va a Home.
- CABA/PFA: `/prestamos-para-policias/policia-federal`; `otra` va a Home.
- Otra provincia: Home.

Las nueve URLs base se verificaron con HTTP 200 el 2026-09-18, conservando UTMs.
Todos los enlaces llevan `utm_source=whatsapp`, `utm_medium=messaging`,
`utm_campaign=web_whatsapp_router` y `utm_content=<segmento>`.
Los segmentos coinciden con los ejemplos de Marketing (`cordoba_jubilado`,
`cordoba_docente`, `cordoba_policia`, `catamarca_policia`, `caba_pfa`,
`otra_provincia`). No se incluyen teléfono, Flow token, IDs del CRM ni secretos.
Datos desconocidos se rechazan; no se convierten silenciosamente en “otra”.

### Campos Bitrix

El job escribe únicamente estos siete campos (prefijo API `UF_CRM_`):

| Campo | Tipo / valor |
|---|---|
| WA_ASSISTED | string: SI |
| WA_ENTRY | string: website |
| WA_FLOW | string: web_whatsapp_router |
| WA_PROVINCE | string: provincia del Flow |
| WA_SEGMENT | string: segmento normalizado del mapa |
| WA_FLOW_ID | string: 1850162769693486 |
| WA_TIMESTAMP | datetime: recepción de la respuesta en UTC |

No modifica SOURCE_ID, UTMs anteriores, nombre, teléfono, responsable o estado.
El tránsito WhatsApp→landing queda separado del origen original. Si ese origen no
está registrado, no se infiere ni se inventa. Esta etapa no cambia el procesamiento
de una futura solicitud enviada desde el formulario web.

`php artisan edna:crm-fields` comprueba el esquema; sale con error si faltan campos.
`php artisan edna:crm-fields --apply` crea sólo faltantes y vuelve a comprobar;
requiere administración CRM y rechaza tipos preexistentes incompatibles. Los jobs
no crean campos al recibir respuestas. El 2026-09-18 se ejecutó el comando desde
el entorno local con el acceso canónico en memoria: los siete campos quedaron
creados y verificados en contactos y leads, sin cambiar valores de registros.

### Operación

- Migración aditiva `2026_09_18_180000_create_edna_router_results`, sin backfill.
- `php artisan edna:results status [id]`: rutas, estados e IDs sin teléfonos ni claves.
  `state=confirmed` acredita el enlace saliente observado; `crm_state=synced`
  acredita la relectura de los siete campos.
- `php artisan edna:results reconcile <id>`: consulta historial de un envío incierto.
  `php artisan edna:results crm <id>`: reintenta sólo CRM. No reenvían WhatsApp.
- `php artisan edna:results prepare <flow_send_id>`: acción explícita para retomar
  una respuesta de piloto ya completada, verificada, conservada y de menos de 23 h.
  Requiere una lista de destinatarios de prueba no vacía y pertenecer a ella.
  Reserva landing/CRM una sola vez; no reenvía el Flow ni modifica su cooldown.
  El piloto anterior puede comprobarse así tras el despliegue sin esperar 24 h.
- No resetear `sending`/`unknown` a `pending`. La incertidumbre persistente requiere
  diagnóstico, no reenvío automático.
- `edna:prune` conserva el destinatario cifrado mientras landing o CRM requieran
  recuperación. Conserva IDs/estados para deduplicar al limpiar payloads.
- Para apagar nuevas acciones, cambiar `EDNA_ROUTER_RESULTS_ENABLED` por Git.
  Receptor y clasificación de respuestas pueden continuar.
- Antes de ampliar a clientes: validar las cinco ramas de cierre de la tarea con
  enlaces y campos reales, continuidad de Bitrix y resolución de casos `review`.

Contratos consultados: [TEXT en Edna](https://docs-pulse.edna.io/docs/api/messages/message-example/),
[búsqueda por teléfono](https://apidocs.bitrix24.com/api-reference/crm/duplicates/crm-duplicate-find-by-comm.html),
[campos de contactos](https://apidocs.bitrix24.com/api-reference/crm/contacts/userfield/crm-contact-userfield-add.html)
y [actualización de contactos](https://apidocs.bitrix24.com/api-reference/crm/contacts/crm-contact-update.html).
