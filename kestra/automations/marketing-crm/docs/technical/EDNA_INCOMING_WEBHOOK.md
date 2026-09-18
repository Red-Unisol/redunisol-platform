# Receptor entrante de Edna

Implementación del receptor para la tarea Bitrix 23055. La entrada pública es Laravel en
`/api/webhooks/edna/incoming`. El worker envía el evento al flow
`edna_incoming_webhook` de este dominio. No envía WhatsApp, no crea leads ni
reasigna conversaciones.

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
  ID: el artefacto marca `flow_id_verified=false`. Conserva `reply_out_message_id`
  y `reply_out_message_external_request_id` si llegaron. Antes de escribir CRM o
  responder automáticamente hay que validar esas referencias o `flow_token`
  contra un envío persistido del mismo canal, destinatario y Flow.

## Configuración y activación posterior

Los ejemplos de entorno dejan esta integración apagada. El receptor no necesita
el token Meta ni la API key de salida de Edna. Usar claves separadas para ambos
saltos y mantenerlas en el circuito local/encriptado de credenciales del repositorio.

| Runtime | Variable | Uso |
|---|---|---|
| Web | `EDNA_INCOMING_ENABLED` | `false` por defecto; habilitar después de preparar Kestra. |
| Web | `EDNA_INCOMING_WEBHOOK_KEY` | Clave que Edna envía al autenticar callbacks. |
| Web | `EDNA_INCOMING_AUTH_HEADER` | `Authorization`, observado en la prueba real de Ventas; sin prefijo. |
| Web | `EDNA_INCOMING_SUBJECT_ID` | Canal autorizado; Ventas observado: `2423`. |
| Web | `KESTRA_EDNA_INCOMING_WEBHOOK_URL` | URL HTTPS completa del trigger interno, con su clave. |
| Kestra | `ENV_EDNA_INCOMING_SUBJECT_ID` | Mismo canal autorizado que en web. |
| Kestra | `SECRET_EDNA_INCOMING_WEBHOOK_KEY` | Clave independiente del trigger, en base64 según la convención Kestra. |

El callback real de Ventas del 18/09/2026 confirmó `Authorization` sin prefijo
`Bearer` ni `Basic`; la observación sólo conserva nombre y formato del header.
La clave entrante corresponde a “edna Pulse request authentication” del registro
de webhook, no a “Your API key” usada para llamar a la API de Edna. Configurar el
valor completo esperado sin decodificarlo ni exponerlo en logs. El receptor debe
confirmar la coincidencia del valor en el primer callback real tras el corte.

### Evidencia y corte a producción

La prueba del 18/09/2026 verificó en la sonda temporal:

- TEXT del canal Ventas y FLOW con `provincia=cordoba` y
  `situacion_cordoba=jubilado_pensionado`; el parser local produjo `flow_response`.
- La respuesta FLOW incluyó `replyOutMessageExternalRequestId` coincidente con el
  requestId usado para enviar el Flow previsto al mismo destinatario.
- Después de activar autenticación, el mismo marker llegó a Bitrix a las
  10:54:15 ART y a la sonda con `Authorization` a las 10:54:16 ART. Se verificó por
  REST en el chat abierto 104293, sesión 293957. No fue necesario modificar Bitrix.

Estos resultados no demuestran todavía la entrega del inbox definitivo a Kestra.
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

La activación sólo recibe y clasifica: todavía no envía formularios automáticamente,
crea leads ni distribuye chats. Esa etapa necesita el registro persistente de envíos,
su correlación y las reglas de destino antes de habilitar efectos comerciales.

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
formatos enumerados (`raw`, `bearer`, `basic`, `empty`, `multiple`). No guarda valores,
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
