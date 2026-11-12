# Intake unificado de WhatsApp Ventas

## Alcance y escritor único

Con `EDNA_ORGANIC_MENU_ENABLED=true`, los ingresos orgánicos de Ventas pasan
primero por la bienvenida de dos opciones. La regla funcional y sus casos se
documentan en [ORG-23571](../kestra/automations/marketing-crm/docs/commercial-rules/ORGANIC_WHATSAPP_23571.md).
Los formularios web explícitos o vigentes mantienen prioridad. Los ingresos con
evidencia actual de pauta pasan directamente al v3, sin el menú general. Un
reingreso antiguo sin continuación web vigente ni pauta actual también puede ver
el menú.

`Quiero un préstamo` reutiliza un perfil completo y confirmado dentro de los
últimos seis meses calendario; sólo los datos faltantes, vencidos o insuficientes
requieren el v3. `Otra consulta` deriva el chat a Tincho, usuario `5737`, con
lectura previa de atención, responsables y sesión. El texto escrito libremente
no autoriza una selección: se valida el token opaco por envío, teléfono,
subject, conversación, vencimiento y selección única.

### Pauta y atribución de la entrada

`EdnaPaidEntry` separa pauta de la bienvenida general usando el inbox autenticado:
`referral.sourceType=ad` o su variante snake_case, los 15 códigos Google `G-*`
documentados en las tareas [23229](https://redunisol.bitrix24.es/company/personal/user/71283/tasks/task/view/23229/)
y [23279](https://redunisol.bitrix24.es/company/personal/user/71283/tasks/task/view/23279/),
el mensaje precargado comprobado en el recurso de WhatsApp de Google Ads, o una
referencia web vigente que acredita una última adquisición paga reciente. En
esta última vía se verifica teléfono/canal y la adquisición dentro de las 24 horas
anteriores a la entrada: click ID de Google o medio pago explícito. El primer
touch histórico, `fbclid` aislado y una fuente Facebook/Instagram sin medio pago
no acreditan que esta consulta actual venga de pauta. Los UTMs
`whatsapp/messaging/web_whatsapp_router` describen asistencia y tampoco lo prueban.

El receptor conserva los alias camelCase y snake_case de Edna, incluidos los
conflictos, dentro de los límites del inbox. Los nombres oficiales de Edna son
`sourceId/sourceType/sourceUrl`; `ctwaClid` se conserva por compatibilidad, sin
suponer que fue recibido ni atribuir un anuncio a partir de ese campo solo.

La selección queda congelada como `entry_routing` dentro del snapshot cifrado
del Flow. No crea journey, anuncio, grupo o campaña ficticios; el texto genérico
declara intención publicitaria, pero conserva red/campaña desconocidas cuando
faltan pruebas. Los códigos se conservan como etiquetas, sin convertirlos en
IDs numéricos de Google. El contrato existente transporta este contexto en
`UF_CRM_ATTR_JSON` y lo conserva hacia la negociación. La fuente CRM puede seguir
como «Sin origen» si el contrato no tiene una adquisición atribuible; la decisión
de pedir v3 por pauta no completa datos de campaña por inferencia.

La vía paga reserva el v3 real de forma idempotente, sin menú ni elección de
cliente ficticios. Espera el vínculo nativo exacto y verifica atención humana
justo antes de enviar, con el lock compartido por chat. Otra entrada de la misma
sesión no envía otro v3 ni reabre el menú. Un vínculo pago todavía pendiente
aplaza el saludo mientras se resuelve, sin atribuirlo como origen confirmado.
Un Flow confirmado de más de 23 horas permite reservar otra consulta paga, pero
su envío exige demostrar una sesión distinta; las escrituras inciertas siguen
bloqueadas. Los recorridos orgánicos y web conservan su comportamiento previo.

Los menús pendientes capturados antes de esta corrección se redirigen sólo si
todavía no se intentó el saludo. Un envío ya aceptado, confirmado o incierto
conserva su conciliación y sus botones; no se le suma un nuevo v3 sin selección.
Este cambio no modifica anuncios, presupuestos, UTMs ni recursos en Google Ads,
ni da por completado el resto de la tarea 23279.

`EDNA_INTAKE_ENTRY_SCOPE=sales_channel` habilita el Flow de intake para los nuevos
ingresos autenticados del canal WhatsApp de Ventas, desde
`EDNA_INTAKE_SALES_CHANNEL_START_AT`. Incluye texto y los tipos multimedia
admitidos por el inbox. No modifica Cobranzas ni otros subjects o líneas.
La creación automática de la ficha del canal permanece activa: Bitrix crea el
prospecto inicial y el intake lo enriquece por ID. El contrato nuevo
`whatsapp-intake-v2` nunca usa `crm.lead.add` como alternativa.

Los nuevos casos de este alcance no usan el Router anterior como alternativa.
El UUID del caso, la entrada original, la admisión y el slot son inmutables.
Cada intento conserva su propio UUID de transporte, mensaje y resultado.
Las respuestas de recorridos históricos siguen procesándose con sus referencias
originales. Los formularios v3 previos todavía no procesados pueden promoverse
al nuevo contrato desde su entrada original; no se repite un envío ni se
promueven escrituras con acuse incierto.

## Prueba de origen y vínculo durable

### Operación del menú orgánico

La activación usa `EDNA_ORGANIC_MENU_ENABLED` y `EDNA_ORGANIC_MENU_START_AT`,
además de las compuertas y listas de destinatarios de intake/router existentes.
`EDNA_ORGANIC_OTHER_OPERATOR_ID=5737` define Tincho y
`EDNA_ORGANIC_PROFILE_MAX_AGE_MONTHS=6` define la vigencia. Compose entrega estos
valores a PHP, workers y scheduler. Los valores de ejemplo permanecen apagados.

`edna_organic_menus` conserva el envío, selección, mensaje original, prueba nativa,
sesión, intención y acuse de transferencia, con fases independientes. El menú usa
`TEXT` con `QUICK_REPLY`; sus payloads contienen un UUID opaco de envío y la acción.
La captura del inbox no hace HTTP. El worker prueba la sesión y la atención antes
de enviar; verifica el historial Edna antes de procesar la respuesta. Un callback
que llegue antes de esa confirmación queda guardado para conciliación.

El menú y el puente web comparten lock por chat y leases por evento. El sondeo
recupera lotes acotados de hasta 25 trabajos por minuto. Las escrituras inciertas
se concilian con lecturas: nunca se repite el POST de saludo o transferencia.
Para una solicitud de reutilización incierta se conserva `loan_unknown`; ese
estado no reanuda ni la evaluación ni el v3 automáticamente.

Cuando la selección necesita el v3, `SendEdnaFlow` vuelve a validar el menú, las
pruebas de la entrada y selección, y la atención nativa después de esperar en
cola y justo antes de reclamar el envío. Una toma, respuesta, transferencia,
cierre o reemplazo de sesión cancela el pendiente; una lectura incierta lo
difiere sin enviar. Usa el mismo lock por chat. Esto cubre cambios durante la
preparación y la espera, sin prometer atomicidad entre Bitrix y Edna.

```text
php artisan edna:organic-menus status --limit=25
php artisan edna:organic-menus poll --limit=25
```

`status` es sólo lectura, sin HTTP ni encolados. `poll` recupera trabajo ya
capturado; no importa conversaciones históricas para enviar saludos.

`edna_customer_profiles` conserva declaraciones completas cifradas con fuente y
fecha originales. Las nuevas respuestas v3 y formularios web confirmados pueden
alimentarlo. Para perfiles anteriores se consultan respuestas aún conservadas,
campos WhatsApp con `WA_TIMESTAMP` comprobable y formularios web con recibo
confirmado y catálogos CRM completos. Los datos agrupados antiguos, incompletos
o sin fecha suficiente requieren confirmación; `DATE_MODIFY` no prueba que el
cliente haya actualizado sus datos. Un perfil reutilizado mantiene su fecha
original. Los status y journals exponen IDs/fases, sin CUIL ni respuestas.

La reutilización usa el contrato autenticado `organic-profile-reuse-v1` en el
webhook de intake. No crea una fila que simule un Flow enviado. Kestra vuelve a
probar mensaje, sesión, persona y gestiones actuales antes de escribir. Si existe
una gestión abierta única devuelve su vendedor; en otro caso inicia la consulta
normal por UUID, conservando responsables y reevaluando los criterios vigentes.
Sólo `reused_not_valid` con `write_attempted=false` habilita pedir el v3 después
de consultar ese endpoint. Un resultado incierto nunca habilita ese fallback.

Desplegar primero el consumidor Kestra compatible y comprobar sus archivos/flow;
luego activar Web. Antes de cualquier despliegue general deben estar en Git los
resguardos de asignación manual que ya estén activos en runtime. Para rollback,
deshabilitar el menú/reutilización antes de retirar el contrato del consumidor;
conservar ledgers y resultados inciertos. Bitrix mantiene el límite de concurrencia
sin comparación atómica de responsable/sesión explicado más abajo.

Los eventos `whatsapp.organic_menu` y `whatsapp.organic_loan` complementan los
recibos durables. Un saludo, un v3 enviado, un perfil reutilizado o un
`transfer_state=not_needed/observed` no prueban una transferencia automática.
El reporte requiere intención/acuse y un evento nativo correlacionado.

### Trabajo pendiente y recuperación de la cola

`EdnaWorkQueue` mantiene una reserva durable para cada comando canónico de
vinculación web, menú o preparación/envío de consulta reutilizada. La reserva
apunta al registro real de `jobs`: también permanece mientras está reservado
por un worker y se retira por clave foránea al eliminarse ese registro tras el
ACK. Un minuto transcurrido desde el encolado no autoriza crear otra copia.
Los pollers excluyen estas reservas antes de seleccionar su lote acotado.
La conexión debe ser la misma base de datos del ledger y el insert de cola
debe ocurrir en la transacción; una configuración incompatible falla sin enviar.

La recuperación operativa es explícita y separada del scheduler:

```text
php artisan edna:work-queue preview
php artisan edna:work-queue apply --cutoff=<cutoff> --preview-sha=<sha>
php artisan edna:work-queue review-preview
php artisan edna:work-queue review-apply --cutoff=<cutoff> --preview-sha=<sha>
```

Los previews son de sólo lectura y exponen identificadores técnicos y hashes.
Cada apply exige el cutoff y SHA exactos de su preview; un cambio concurrente
invalida el plan y revierte la operación. La deduplicación sólo admite jobs
`LinkWebFormChat` o `ProcessEdnaOrganicMenu`, no reservados y con cero intentos,
cuya clase, ID positivo y comando serializado coincidan exactamente con el
comando canónico. Conserva un keeper por grupo, o la reserva válida existente;
no elimina recepción de mensajes, envíos, bindings ni variantes desconocidas.
Adopta los keepers en la nueva reserva sin cambiar sus argumentos ni su fecha.

Reabrir reviews es otra operación: sólo admite las razones de lectura nativa o
de proveedor pendientes, dentro de la ventana original y sin prueba, sesión,
lease, elección, perfil, caso, envío o intención/acuse de transferencia. Conserva
UUID, entrada, expiración y contador de intentos. No ejecuta el job ni envía un
mensaje: el procesamiento normal debe volver a comprobar identidad y atención
humana. No se reabren estados inciertos ni se renuevan ventanas de WhatsApp.

Un job de recuperación no equivale a un chat distinto. Los conteos de cola y
duplicados no se presentan como porcentajes de distribución automática.

`edna_intake_bindings` vincula un caso/envío y su entrada con un único prospecto
original. El teléfono permite descubrir candidatos, pero no autoriza el vínculo.
La prueba exige simultáneamente:

1. Inbox y envío coherentes en subject, mensaje, destinatario y evento original.
2. Actividad `IMOPENLINES_SESSION` del prospecto candidato, con sesión concreta.
3. Historial de esa sesión y chat, sin truncamiento.
4. Identificador Edna original presente exactamente en `connectorMid` del mensaje
   nativo de Bitrix; no una comparación aproximada del texto o la hora.
5. Diálogo del conector `whatsappbyedna`, línea `1`, con código de usuario y
   relación CRM correspondientes al mismo prospecto.

La prueba guarda únicamente IDs técnicos; no copia teléfono, CUIL ni textos del
cliente. La sesión actual puede haberse cerrado: se consulta la sesión histórica
exacta asociada a la actividad. Un historial, lote o selección incompletos no
demuestran unicidad. Una ficha ya vinculada a otro caso pasa a revisión.

El job de resolución realiza lecturas acotadas y reintentos antes de cualquier
mutación CRM. El procesador del formulario consume sólo una prueba ya verificada
en DB, conservando su presupuesto HTTP y evitando repetir escrituras por timeout.
Si falta una prueba o hay ambigüedad, se conserva la respuesta cifrada en
`awaiting_binding`/revisión; no se fabrica un segundo prospecto.

## Identidad, estado y atribución

El ID del caso identifica la consulta; el vínculo identifica la ficha de origen;
el CUIL validado identifica a la persona. Un teléfono compartido no fusiona
identidades. El consumidor relee el prospecto y la conversación, conserva el
responsable y los datos humanos, y rechaza contradicciones de CUIL, contacto,
perfil, atribución o caso previo. No reabre una gestión finalizada ajena.
Ingreso y Preclasificación no invalidan el vínculo. Los resultados explícitos
de rechazo o corrección siguen teniendo su tratamiento comercial.

La ficha nativa puede iniciar con motor comercial `Bitrix`. El intake autenticado
puede traspasarla a Kestra sólo si sigue en Guest, Ingreso o Preclasificación, sin
caso anterior ni política de procesamiento explícita. Conserva su responsable;
un owner Manual/desconocido, una política explícita o una etapa avanzada siguen
en revisión. La identidad, el contacto y las gestiones existentes se comprueban
antes de persistir, igual que en los demás ingresos.

La atribución web resuelta conserva su journey y campañas. Los ingresos directos
se registran como `whatsapp_directo`; una referencia no verificable queda sin
atribución confirmada. No se inventan journeys ni UTM. El contexto se congela por
caso, sin consultar el último contexto mutable del teléfono al recibir la respuesta.

## Continuación de un formulario web

El servidor registra `web_form_receipts` antes de la precalificación y del job
que persiste el formulario. La respuesta de éxito devuelve una referencia opaca;
el botón de WhatsApp la incluye como `(solicitud: ...)`. Sólo se almacena su hash.
El mensaje autenticado debe presentar una única referencia vigente y el mismo
teléfono normalizado. Esta referencia conserva la solicitud original y no agrega
una campaña ni un journey nuevos.

Antes de reservar un Flow, el intake registra esa continuación: espera el acuse
web si sigue pendiente, reutiliza el lead si ya fue persistido o pasa a revisión
si la persistencia falló o quedó incierta. `WebFormContinuation` no hace HTTP al
CRM ni envía otro formulario: una continuación `ready` encola `LinkWebFormChat`,
que ejecuta el servicio `WebFormChatLinker` por separado. El acuse web actualiza
las continuaciones ligadas a su `submission_id` y también encola el vínculo cuando
una espera termina en `ready`. Sin referencia ni una reentrada exactamente
comprobada, un teléfono compartido o la frase post-formulario sin evidencia del
servidor se conservan en revisión sin seleccionar una persona o un lead.

El registro web y la reserva final de envío comparten un bloqueo por teléfono
normalizado. Si el formulario fue aceptado antes del claim de envío, se cancela
el Flow todavía pendiente; no se cambian las admisiones ni los slots históricos.
Un envío que ya fue reclamado o aceptado debe conciliarse, nunca repetirse.
Las referencias duran 24 horas y no contienen teléfono, CUIL ni IDs de CRM.

### Vínculo con una negociación ya asignada

Seguimiento: [tarea Bitrix 23571 — completar la distribución automática de chats](https://redunisol.bitrix24.es/company/personal/user/71283/tasks/task/view/23571/).

El puente sólo procesa una referencia de solicitud comprobada o un reingreso
cuya conversación anterior y nuevo mensaje puedan demostrarse exactamente.
`web_form_chat_routes` conserva una fila por `entry_event_id`, con solicitud,
prueba de IDs técnicos, destino, lease, disponibilidad y fases independientes
`link_state` y `transfer_state`. Los callbacks y acuses duplicados no crean otro
trabajo original ni reemplazan la solicitud de una fila existente.

Además del lease por evento, un lock compartido por `chat_id` evita que mensajes
distintos de la misma conversación transfieran en paralelo. En producción se
exige un cache compartido de base de datos o Redis; sin él, la ruta espera.

Para resolver la conversación, `EdnaMessageBinding` exige el mensaje autenticado
de Edna en el `connectorMid` de una sesión concreta de Bitrix, su actividad
`IMOPENLINES_SESSION`, historial completo y el conector de Ventas de la línea 1.
El teléfono sólo permite descubrir candidatos; no demuestra una relación CRM.
Si la persistencia web, la sesión nativa o la asignación comercial siguen
pendientes, el trabajo espera y se recupera sin crear prospectos ni negociaciones.

El destino debe ser una única negociación vigente de categoría 1, con semántica
`P` y `LEAD_ID` igual al prospecto confirmado del recibo web. Prospecto y
negociación deben conservar el mismo contacto y vendedor actual; el CUIL del
prospecto y del contacto debe coincidir con la identidad del recibo. Se exige
un vendedor interno activo y una asignación comercial finalizada, no una ficha
todavía en la cola o con responsable provisional. No se elige una negociación
entre varias por compartir teléfono o contacto. Una discrepancia de identidad
requiere revisión; una asignación humana diferente se conserva.

El responsable del Guest tampoco se considera provisional sólo por ser Maru o
Nico: cuando difiere del vendedor, se exige además que coincida con el creador
nativo entre esos receptores. Un Guest creado por Maru y actualmente asignado a
Nico se conserva. Esta coincidencia es una restricción conservadora, no una prueba
absoluta del historial de responsables. El usuario de API compartido y la fecha
de modificación no demuestran una asignación automática.

El vínculo se materializa con `crm.activity.binding.add` sobre la actividad
nativa, añadiendo el contacto y la negociación a su timeline. Se comprueba el
resultado con `crm.activity.binding.list`. Esto no equivale a reasignar la
identidad nativa del chat: se mantiene su asociación original, incluido el
prospecto Guest cuando lo hay. El puente no borra esa asociación, no crea
fichas ni escribe perfiles, CUIL o responsables comerciales para forzar una
coincidencia. Un vínculo con otro contacto o negociación bloquea la operación.

Antes de transferir, `WebFormChatGuard` comprueba la sesión y su historial de
transferencias y atención. Una aceptación humana, una respuesta del operador,
una transferencia explícita o un responsable distinto se conservan incluso
cuando el dueño visible sigue siendo el mismo receptor de la cola. Se releen
la negociación, el prospecto, el contacto, la identidad nativa y el diálogo
después de añadir vínculos y justo antes del único POST de transferencia. Un
cambio de vendedor, contacto, sesión o responsable detiene la derivación; si
el chat ya está con el vendedor correcto, no se vuelve a transferir. La sesión
cerrada puede quedar vinculada sin que se la reabra.

**Límite de concurrencia:** Bitrix no ofrece una operación de comparación y
actualización atómica del responsable y la sesión para este POST. Las lecturas
finales reducen la carrera con una acción humana, pero no la eliminan: un cambio
entre la última lectura y la transferencia todavía es posible. El lease de la
tabla coordina nuestros workers, no bloquea a los operadores de Bitrix. No se
promete atomicidad del proveedor. Se verifica el resultado y cualquier cambio
inesperado de responsable CRM queda para revisión, sin restaurar un valor viejo
que pudiera reemplazar una decisión humana posterior.

Una reapertura sin referencia puede despertar resolución si ya existe una ruta
comprobada para ese teléfono. El trabajo empieza sin seleccionar solicitud,
negociación ni vendedor: debe probar el nuevo mensaje y encontrar una única
relación anterior para el mismo `chat_id`. La asignación y la identidad vigentes
se verifican de nuevo. La atención/asignación humana protegida del mismo caso se
conserva también en la reapertura; sólo se habilita el destino cuando la asignación
comercial vigente coincide con esa persona. Una ruta comprobada que espera vendedor
también puede recuperarse al reabrirse la conversación. Si hay otra solicitud
reciente para ese teléfono, se exige su referencia. Un teléfono compartido, una
conversación distinta o una relación no única nunca autorizan reutilizar una ficha.

Si la transferencia queda `sending` o `unknown`, el siguiente intento sólo
consulta su resultado; no repite el POST. Encontrar después al vendedor esperado
puede producir `transfer_state=observed`, pero eso por sí solo no prueba que la
automatización haya realizado la transferencia. Para atribuir autoría en el reporte,
se necesita evidencia del proceso y una transferencia nativa correlacionada; no
basta con la fase guardada o con que el vendedor ya sea dueño. Si aparece otra sesión o una decisión
humana posterior, se conserva; los resultados inciertos que no se resuelven
terminan en revisión.

### Operación y recuperación del puente

Se mantienen las compuertas existentes `EDNA_INCOMING_ENABLED` e
`EDNA_INTAKE_CRM_ENABLED`. El worker no modifica CRM con ellas deshabilitadas;
el scheduler sólo despacha recuperación cuando ambas están activas. La
recuperación corre cada minuto y toma un lote acotado, con disponibilidad cumplida
y sin lease vigente. Los estados `unknown` sólo se despiertan para conciliación
de una transferencia `sending`/`unknown`, mediante lecturas.

```text
php artisan edna:web-forms status
php artisan edna:web-chat-routes status --limit=25
php artisan edna:web-chat-routes poll --limit=25
```

Los comandos `status` muestran recibos/continuaciones y estados del puente,
respectivamente, sin HTTP a Bitrix ni encolados. `poll` devuelve la
cantidad encolada, admite límites de 1 a 100 y no selecciona fichas ni transfiere
chats directamente. Para el estado por evento del puente se conservan `state`,
`reason`, `link_state`, `transfer_state`, `attempts` y la prueba técnica en
`web_form_chat_routes`. No se debe interpretar una fase incierta como permiso
para repetir una escritura. El poll no crea trabajo a partir de continuaciones
históricas ni recupera automáticamente casos `review` o ambiguos.

Cada resultado agrega `whatsapp.web_chat_route` al journal con IDs técnicos y
fases, sin teléfonos ni texto del cliente. La fila durable sigue siendo la fuente
primaria si falla el tracking; ese fallo nunca permite repetir una transferencia.

El seguimiento de la tarea 23571 usa un chequeo diario en Codex a las 09:30 de
Argentina, separado de este scheduler operativo. Entrega un borrador para comentar
en la tarea con los números del día calendario anterior: chats automáticos,
manuales y mixtos, intervención humana total, pendientes y cobertura de evidencia.
El borrador se revisa en Codex y nunca se publica automáticamente en Bitrix.

Para incorporar los formularios anteriores al despliegue, inspeccionar primero:

```text
php artisan edna:web-forms import --date=2026-11-04 --date=2026-11-05 --date=2026-11-06
php artisan edna:web-forms status
php artisan edna:web-forms reconcile
```

`import --apply` agrega sólo recibos ausentes desde el journal del servidor,
validando sus hashes, UUIDs y acuses; no toca CRM ni vuelve a encolar formularios.
Un formulario importado sin acuse queda incierto. Las referencias históricas no
se inventan ni se envían al cliente.

Para conciliar respuestas redundantes ya guardadas, el operador debe verificar
que la ficha web sigue disponible, que los datos no contradicen el formulario
y que conserva su continuidad comercial. Si el acuse incluye un contacto previo,
comprobar también que sigue vinculado a esa ficha y al mismo CUIL; el ID informado
por una revisión previa a las escrituras no implica que el intake lo haya creado.
Después puede aplicar sobre IDs
explícitos con `reconcile --request=ID --confirmed-crm-continuity --apply`.
El comando exige además respuesta sin escrituras CRM, vínculo original verificado,
mismo CUIL y teléfono, mismo lead web y recepción web dentro de las 24 horas
anteriores al ingreso. Conserva respuesta cifrada, envío y contadores; registra
el motivo anterior y la evidencia de conciliación. Los casos ambiguos o con
acuse de escritura incierto quedan para revisión.
La aplicación de una conciliación comprobada que termine en `ready` también
puede encolar el puente. El comando no hace HTTP directo, pero el trabajo
posterior puede añadir vínculos y derivar el chat con las comprobaciones
anteriores; no debe considerarse una operación exclusivamente local de extremo
a extremo.

## Fallos de entrega

El historial Edna debe ser completo y contener un único mensaje de identidad
coherente. `FAILED`, `INVALID`, `UNDELIVERED` y `CANCELLED` son resultados negativos
aunque el proveedor no incluya contenido del Flow en el mensaje fallido.
`SENT`, `DELIVERED` y `READ` sí requieren el Flow y su ID correctos para confirmar.
Un HTTP aceptado por el proveedor no demuestra entrega; el reconciliador nunca
repite el envío. La falta de saldo del proveedor debe corregirse por el operador
antes de validar nuevas entregas reales.

## Catálogos vacíos y recuperación de respuestas guardadas

Bitrix puede representar un catálogo vacío como `false`, además de `null`,
cadena vacía o lista vacía. En provincia, situación laboral y banco esos valores
permiten completar la ficha original. Un ID real distinto conserva el bloqueo
`bound_profile_conflict`; no se ignoran valores numéricos como `0` ni otros tipos
inesperados.

Ese bloqueo, y `bound_management_requires_review`, se producen antes de crear
contactos o actualizar el prospecto. Su
acuse contiene el ID del prospecto original verificado, aunque no haya escrituras.
Para recuperar una respuesta ya auditada se puede usar:

```text
php artisan edna:intake rescue REQUEST_ID --expected-case=CASE_UUID --expected-lead=LEAD_ID --confirmed-no-writes --apply
```

El operador debe comprobar la ausencia de escrituras CRM antes de aplicar. Para
estos motivos concretos el comando exige contrato V2, prueba de origen verificada,
caso/entrada/mensaje/prospecto coincidentes y ningún contacto registrado en el
acuse. Los estados inciertos o en proceso siguen sin poder repetirse. El preview
sin `--apply` sólo lee. Se encola el procesamiento de la respuesta cifrada original,
sin otro formulario, caso, intento de transporte, admisión ni slot. Un caso ya
sincronizado es un no-op; un segundo apply mientras está pendiente no encola otro job.

## Reenvío controlado de un fallo confirmado

Edna exige un `requestId` nuevo para cada solicitud: un UUID ya utilizado produce
`requestId-is-not-unique`, incluso si el intento quedó fallido. Ver
[errores del proveedor](https://docs-pulse.edna.io/docs/api/messages/errorcodes/).
El caso conserva su `request_id`; `transport_request_id` es el alias del intento
activo. El callback se resuelve por ese alias y después usa el UUID del caso hacia
Kestra. Un callback del intento anterior no se aplica al nuevo.

`edna_flow_send_attempts` conserva el intento original y el único reenvío
controlado permitido. La reserva del intento nuevo y su UUID ocurre antes del
POST, junto con el archivo del fallo original y la cola del envío. No crea otra
entrada, admisión, contacto ni prospecto. Los jobs antiguos no pueden enviar ni
degradar el estado de un intento posterior. Un timeout requiere conciliar el
historial; nunca autoriza otro POST automático.

`php artisan edna:flow-resend ID` muestra el preview sin cambios. La aplicación
requiere `--apply`, `--expected-case=UUID`, `--expected-lead=ID`,
`--expected-old-mid=ID`, `--operation=UUID` y `--confirmed-no-attention`.
El operador debe verificar antes la ausencia de atención posterior. El comando
revalida un único fallo terminal en el historial completo, la ventana y el contexto,
y comprueba que el vínculo al prospecto coincida. Los v3 web todavía sin procesar
se promueven al contrato ligado a la ficha original antes de encolar el reenvío.
Repetir la misma operación devuelve su intento existente sin otro mensaje.

Confirmar después `SENT`, `DELIVERED` o `READ` por historial y guardar el MID del
intento activo. Un HTTP aceptado no demuestra entrega. La autorización de un lote
no autoriza otros destinatarios ni otro intento ante un resultado incierto.

## Despliegue y rollback

1. Publicar primero el consumidor Kestra compatible con V1, V2 y pruebas existentes.
2. Verificar los namespace files contra Git; mantener el scope antiguo durante
   esta etapa. El receptor Web nuevo intercepta el alcance unificado antes del
   clasificador histórico.
3. Publicar Web con las migraciones de contexto y bindings; luego habilitar el
   scope y su corte mediante configuración cifrada Git-managed.
   El puente necesita además la migración de `web_form_chat_routes` y workers
   compatibles con `LinkWebFormChat`; verificar también el scheduler de su poll.
4. Verificar configuración, migraciones, workers y páginas públicas. La lectura
   de una conversación real permite comprobar los IDs de origen sin enviar nada.
5. Comprobar, cuando el saldo permita tráfico auténtico, una respuesta que actualice
   el prospecto original, sin otro lead, y termine el recorrido comercial.

Rollback: `EDNA_INTAKE_ENTRY_SCOPE=website` restringe las nuevas entradas; conservar
el consumidor y las tablas capaces de finalizar los casos V2 ya abiertos.
No borrar bindings, respuestas, admisiones ni contadores; no apagar recepción o
CRM para ejecutar el rollback.
Para el puente, conservar `web_form_receipts`, `web_form_continuations`,
`web_form_chat_routes`, sus pruebas y fases, y un consumidor compatible con los
jobs ya encolados. Revertir código no autoriza borrar rutas, quitar vínculos
nativos ni repetir transferencias con acuse incierto. Una versión de rollback
debe seguir pudiendo conciliar esos resultados mediante lecturas.
