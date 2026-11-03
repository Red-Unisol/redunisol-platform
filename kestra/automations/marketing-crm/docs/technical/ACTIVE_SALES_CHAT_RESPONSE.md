# Pase a Respuesta por WhatsApp activo

Tarea Bitrix 22903. `bitrix24_deal_chat_response` atiende cada minuto una cola
durable de avisos de WhatsApp y de negociaciones recien clasificadas. Revisa
solo esos casos en Presentación (`C1:NEW`) y Revisión Manual (`C1:KESTRA_REVIEW`).
Sólo escribe `stageId = C1:UC_ZH5DGU` (Respuesta).

## Decisión comercial

La clasificación guarda `approved`, `manual_review`, `rejected` o
`commercial_rejected` en `UF_CRM_K_COMM_DECISION` (`ufCrmKCommDecision` en
`crm.item`). Se persiste antes de sacar la negociación de Pendiente Calificación.
Si falla la escritura, la clasificación no continúa. La cola de distribución
conserva este campo.

Las escrituras usan el nombre original `UF_CRM_K_COMM_DECISION` y
`useOriginalUfNames: Y`, con lectura posterior obligatoria: en este portal se
verificó que escribir el nombre camelCase podía devolver éxito sin guardarlo.

Revisión Manual también puede contener rechazos comerciales: no se debe inferir
aprobación a partir de la etapa, el vendedor o la existencia de chat. Sólo
`approved` y `manual_review` habilitan el cambio; campo vacío o desconocido omite
el caso. La automatización no vuelve a consultar BCRA/Vimarx ni decide crédito.

Crear el campo antes de publicar los archivos que lo escriben:

```powershell
$env:PYTHONPATH='kestra/automations/marketing-crm/files'
python -m bitrix24_form_flow.provision_deal_commercial_decision
```

Usa las variables Bitrix habituales del runtime. La provisión es idempotente,
rechaza tipos incompatibles y no se ejecuta desde el scheduler.

## Conversación y concurrencia

Consulta chats activos vinculados a negociación, lead o contacto; deduplica por
chat. Exige conector `whatsappbyedna`, Canal Abierto VENTAS (`1`), sesión presente
y escritura habilitada por Bitrix. No inicia sesiones, envía mensajes, acepta
conversaciones ni cambia responsables. Una sesión histórica o de otro canal no
habilita el cambio.

El cambio de etapa sí dispara los robots existentes de Bitrix. Al publicar se
revisó la plantilla 135 de Respuesta: contiene el correo «¿Seguimos con tu
solicitud?», no una apertura de WhatsApp. Esta implementación no modifica ese
robot ni sus condiciones de envío.

Relee etapa, decisión, vínculos y fecha de modificación inmediatamente antes de
escribir. Cualquier cambio durante la inspección omite el caso. Bitrix REST no
ofrece una actualización condicional de versión en este método: hay una pequeña
ventana residual entre lectura y escritura. No es un bloqueo sobre el asesor.

## Cola, exclusión y presupuesto

La web encola el telefono del mensaje entrante de Edna dentro de la misma
transaccion que procesa el inbox. Se conserva cifrado con APP_KEY y se identifica
con un HMAC, sin telefonos en logs. Los avisos de la misma persona se agrupan; los
repetidos o antiguos no incrementan la generacion. Un mensaje nuevo durante el
procesamiento deja otra generacion pendiente y no se pierde al confirmar la vieja.
Se esperan 15 segundos desde el primer aviso para agrupar mensajes y tolerar el
retraso del callback independiente de Bitrix. La clasificacion tambien encola el
ID de una negociacion que acaba de quedar en una etapa habilitada: recupera el
caso donde la conversacion existia antes de crear la negociacion.

`bitrix_chat_response_queue` y `bitrix_chat_response_state` viven en PostgreSQL de
la web. El endpoint `/api/internal/bitrix-chat-response/{claim,renew,finish,enqueue}`
usa el token interno de asignacion ya compartido (`BITRIX_ROUTING_ALLOCATION_TOKEN`
en web, secret `BITRIX24_ROUTING_ALLOCATION_TOKEN` en Kestra). Valida tambien el
namespace: el runtime dev no puede consumir la cola prod.

El claim usa una transaccion y bloqueo de fila para otorgar un solo lease global.
Dura 180 segundos, se renueva antes de cada llamada CRM y una confirmacion de un
propietario viejo se rechaza. Un proceso que pierde el lease deja de llamar a
Bitrix. La exclusion no depende del contador interno de concurrencia de Kestra.
El flow conserva `concurrency.limit: 1` como defensa adicional. El entrypoint
anterior delega al nuevo worker: una revision vieja reentregada no puede volver
al barrido completo ni ejecutar sin configuracion de cola.

Cada tanda dispone de 45 segundos y un maximo absoluto de 20 intentos HTTP a
Bitrix, incluidos los reintentos. El intervalo minimo entre intentos es dos
segundos (como maximo 0,5 llamadas/segundo), para reservar capacidad a ingreso y
calificacion. Solo lecturas rechazadas expresamente con QUERY_LIMIT_EXCEEDED se
reintentan, con espera creciente. Se mantiene la lectura de verificacion tras
una escritura incierta y no se repite esa escritura a ciegas.

Los avisos por telefono buscan solo sus contactos/leads y las negociaciones
relacionadas; los avisos por ID leen solo esa negociacion. El presupuesto conserva
el cursor de la ultima negociacion completamente inspeccionada. Una espera de
sesion/registro se reevalua hasta tres veces; los errores tecnicos hasta seis,
y una nueva actividad reactiva el caso. Los trabajos completados se purgan a los
siete dias con `edna:prune`.

Sin eventos disponibles hay una reconciliacion de respaldo cada 15 minutos, con
el mismo presupuesto y un cursor persistido por ID. Continua desde donde termino;
no vuelve a barrer toda la base cada dos minutos. Este respaldo tambien recupera
avisos perdidos o casos historicos. El calendario usa `recoverMissedSchedules:
NONE`: recuperar minutos viejos no aporta datos nuevos a esta cola.

## Logs y diagnóstico

`bitrix24_chat_response_worker_summary` informa modo (`event`, `fallback`, `busy`,
`idle`), resultado, llamadas por metodo, intentos fallidos y conteos de casos. Los
modos busy/idle hacen cero llamadas a Bitrix. Los errores solo conservan su tipo.
Los eventos individuales quedan en `result_json`, sin duplicarlos en el resumen.
Un error produce `ok=false` y salida de proceso distinta de cero; el agotamiento
del presupuesto conserva trabajo pendiente como `outcome=retry`.

Para desplegar: publicar primero la web y sus migraciones; luego los namespace
files y flows. Si el consumidor se publica primero, falla cerrado hasta que el
endpoint este listo. En una recuperacion de barridos anteriores, pausar el trigger,
guardar sus IDs y cancelar sus ejecuciones por la API antes de reactivar el worker.
No ajustar directamente tablas internas de Kestra para fabricar concurrencia.
Verificar en produccion exclusion de claims simultaneos, eventos de la cola,
trafico hacia Bitrix y avance real de los prospectos.

## Negociaciones anteriores a la incorporación del campo

No convertir valores vacíos en aprobaciones. Se pueden recuperar decisiones de
las salidas originales de Kestra para los casos todavía en las dos etapas de
origen: validar namespace/flow, ID de negociación y lead, decisión explícita,
etapa resultante y ausencia de modificaciones posteriores. Releer el registro
antes de escribir exclusivamente el campo nuevo. Conservar ejecución fuente,
valor aplicado y omisiones en el artefacto privado de la intervención.

Un caso sin evidencia concluyente conserva su etapa hasta una revisión explícita.
Esta recuperación no debe recalificar ni reproducir ejecuciones históricas.

## Publicación y verificación

Subir primero los namespace files nuevos, después los consumidores modificados y
por último el flow con su cron. Verificar el tipo y el nombre camelCase del campo
mediante `crm.item.fields`, los archivos activos y una ejecución real. El despliegue
de desarrollo elimina el cron por `schedule_scope: prod_only`.

Para detener la automatización, deshabilitar su flow desde una revisión Git y
publicarla; conservar el campo y las decisiones registradas. No revertir etapas
en masa, porque el asesor puede haber continuado la gestión.
