# Solicitud única dentro de WhatsApp

Definición acordada el 22/10 y ampliada el 27/10/2026: todos los segmentos del Router
actual, exclusivamente para una entrada desde el botón de la web con referencia
vigente y vinculada al teléfono/canal. CUIL obligatorio y email opcional.
El alcance inicial es una tanda persistente de **10 números de WhatsApp únicos**;
el resto continúa por el Router anterior y su formulario web.

## Recorrido

Botón web → mensaje del cliente → un único Flow → persistencia en Bitrix →
prefill y clasificación existentes → continuidad comercial por WhatsApp.

El nuevo Flow no ofrece volver al formulario web. No genera una landing,
temporizador ni un segundo Flow de asistencia. Los Flows anteriores ya enviados
conservan su procesamiento para no perder respuestas en curso. Las entradas por
WhatsApp directo o con referencia ausente, vencida o de otro teléfono/canal no
reciben el nuevo formulario. No se recupera el origen desde el historial del CRM.

El [JSON para Meta](whatsapp-website-intake.flow.json) recoge provincia, situación
laboral, CUIL y email opcional. Para jubilados de Córdoba pregunta Caja/ANSES/ayuda;
Caja no exige banco. Los demás casos preguntan banco de cobro (Bancor, Nación,
otro o necesito ayuda). Los campos ocultos de otras ramas se ignoran.

### Tres opciones adicionales para Córdoba (28/10/2026)

La [versión siguiente del JSON](whatsapp-website-intake-cordoba-v2.flow.json)
agrega únicamente **DASPU**, **Empleado público municipal** y **Jubilado municipal**
al campo de situación laboral de Córdoba. Conserva los campos, las cuatro opciones
de provincia y todas las demás ramas del formulario publicado. El JSON original
anterior sigue representando la versión 1; no se modifica el Router histórico.

| Opción en WhatsApp | Situación en Bitrix | Regla comercial existente |
| --- | --- | --- |
| DASPU | DASPU (`4073`) | Se evalúa como DASPU de Córdoba, circuito UNC/DASPU. |
| Empleado público municipal | Empleado Público Municipal (`1273`) | Requiere Bancor para precalificar; circuito Córdoba General. |
| Jubilado municipal | Jubilado Municipal (`3129`) | Requiere Bancor para precalificar; circuito Córdoba Jubilados. |

Las tres opciones utilizan `banco_cordoba`; no pasan por Caja/ANSES y se ignoran
los valores ocultos de esa rama. No se agregan criterios de aprobación: los datos
se guardan con la categoría exacta y pasan por el prefill y la precalificación
habituales. CUIL inválido, email inválido o banco "necesito ayuda" conservan sus
derivaciones manuales. Catamarca y CABA no aceptan estas tres opciones.

El backend es compatible con las respuestas de la versión 1. Desplegarlo no
modifica por sí solo el formulario publicado en Meta. La versión 2 debe validarse
y publicarse como un Flow nuevo antes de ofrecer esas opciones; el ID activo y
la tanda actuales no se cambian en esta entrega. No cambiar el ID de una tanda
existente ni reiniciar su contador. Al preparar una activación de la versión 2,
resolver también la aceptación explícita de ambos IDs en el procesador Kestra:
hoy `EDNA_INTAKE_FLOW_ID` admite un solo ID y cambiarlo sin ese paso bloquearía
las respuestas pendientes de la versión 1.

Cada respuesta autenticada del formulario se conserva como lead, también cuando
el CUIL falta o es inválido. Sólo un CUIL de 11 dígitos con checksum válido se usa
en el campo canónico y para buscar identidad. El valor inválido se conserva en
`UF_CRM_WA_CUIL_INVALID` ("CUIL informado inválido (no usar como identidad)") y el
lead queda en **WHATSAPP - CORREGIR CUIL** (`UC_WA_CUIL_REVIEW`), con owner manual
y sin contacto inferido por teléfono, prefill ni clasificación automática.
`UF_CRM_WA_REVIEW_REASON=pending_cuil` identifica el motivo. No se corrige ningún
dígito ni se confirma identidad mediante el checksum. El original completo sigue
cifrado en el ledger; el campo operativo conserva hasta 255 caracteres.

«Otra provincia», «otra situación», organismo/banco "ayuda" o email inválido
generan un lead manual sin precalificación. El email inválido se conserva como
dato sin validar en los comentarios, nunca en EMAIL del lead/contacto. Contratos,
procedencia o estructuras inválidas siguen rechazándose antes de escribir.
Las respuestas completas reutilizan las reglas comerciales vigentes; este
desarrollo no cambia elegibilidad ni distribución.

## Piloto de los próximos 10 ingresos únicos

Al activar el piloto, las próximas 10 personas elegibles desde la web reciben el
nuevo Flow. La identidad única se calcula por número normalizado de WhatsApp,
con HMAC; varios mensajes, referencias web o visitas del mismo teléfono no ocupan
otro lugar. Una persona que abandona cuenta como participante.

La reserva se hace en `edna_intake_pilots` / `edna_intake_admissions`, dentro de la
misma transacción que guarda el envío y su trabajo en cola. El bloqueo de la fila
de la tanda, el incremento condicionado a menos de 10 y las claves únicas impiden
superar el cupo ante entradas simultáneas. Si el encolado falla, todo se revierte.
Un envío ya reservado fallido, cancelado o incierto conserva su lugar; no se
reciclan cupos automáticamente.

Al llegar a 10, el ingreso único número 11 y los posteriores reciben el Router
anterior y conservan el enlace al formulario web. También siguen ese recorrido
los ingresos sin referencia válida, anteriores al corte o fuera de la lista de
prueba. No se apaga el procesamiento del nuevo Flow al agotar el cupo: los
participantes ya admitidos pueden responder y terminar su solicitud. Una nueva
entrada del mismo participante conserva su asignación y el cooldown de 24 horas,
incluso con el cupo agotado; la reserva es por persona y tanda, no por cada envío.

La tanda se identifica con `EDNA_INTAKE_PILOT_ID` (por defecto
`website-intake-10-v1`) y el canal de Ventas. Reinicios, deploys y agotamiento no
reinician el contador. Para otra tanda hay que configurar explícitamente un ID
nuevo por el circuito Git-managed. Los envíos de la tanda anterior siguen
identificados por su admisión; no borrar filas ni cambiar el ID del Flow en Meta
para reiniciar una prueba. La lista de Kestra debe seguir admitiendo a quienes
están completando su solicitud.

## Persistencia y trazabilidad

El receptor autenticado Edna conserva su integración principal con Bitrix. La
recepción propia verifica requestId, mensaje saliente confirmado por historial,
teléfono, canal, Flow y ventana de conversación antes de aceptar una respuesta.
El ledger separa el cooldown por admisión en el piloto y por Flow en el recorrido anterior; el nuevo intake guarda una sola
respuesta cifrada por envío en `edna_intake_requests` y encola un trabajo atómico.

El webhook `bitrix24_whatsapp_intake` tiene un escritor dedicado. Primero busca
por el CUIL válido en contactos y leads activos; el teléfono es un canal compartido,
no una identidad única. Un contacto inequívoco por CUIL puede conservar varios
números y un número puede pertenecer a varias personas. Una identidad nueva con
CUIL válido obtiene un contacto separado. No se fusionan contactos históricos.

La búsqueda por teléfono sólo permite completar un Guest activo, sin nombre
personal, contacto, CUIL, owner comercial ni datos de formulario. Si hay varios
Guests no se elige uno: se crea un lead para el caso. Un formulario nuevo nunca
sobrescribe el lead de otra persona ni una gestión existente. Con varios contactos
del mismo CUIL, conflictos de vinculación o una gestión abierta, se guarda un lead
manual y se anotan los IDs relacionados para continuar la gestión. Una gestión
abierta no se duplica como negociación. Un único contacto por CUIL puede vincularse
al lead manual; una identidad ambigua queda sin contacto.

El UUID original se comprueba antes de cualquier escritura. Un reenvío del mismo
caso devuelve el mismo lead sin escribir; si el caso era manual conserva ese
estado. UUID con teléfono, Flow o identidad distintos requiere reconciliación.

Se reutilizan los campos de asistencia y se agregan los dos campos de revisión
anteriores; ninguno se hace obligatorio globalmente en Bitrix. `WA_FLOW=web_whatsapp_intake`,
`WA_SUBFLOW=website_single_intake`, `WA_CONTINUIDAD=whatsapp` y
`WA_ASSISTANCE_ID=requestId` identifican el recorrido. Se preservan first/last touch,
campaña, referencia y fecha de respuesta. El CUIL puede completar el nombre a
través del prefill normal; no se inventa la identidad.

## Flow publicado y activación preparada (27/10/2026)

Meta publicó `Solicitud web | CUIL obligatorio | Piloto 10 v1`, ID
`3298964390491520`, en la cuenta Red Unisol (`823632237115803`). El JSON se
validó y guardó sin errores. El piloto conserva el ID `website-intake-10-v1` y
el máximo persistente de 10 números únicos; no se envían pruebas a clientes ni
se reservan cupos al publicar.

La configuración cifrada de producción prepara el inicio desde
`2026-10-27T15:25:04+00:00`; sólo empieza a admitir cuando se despliega la
configuración habilitada. Desarrollo conserva las banderas apagadas. El Compose
propaga las variables a PHP y los workers, y el webhook invoca el entrypoint
dedicado `kestra_whatsapp_intake_entrypoint`.

Antes de dar la activación por terminada, verificar las banderas efectivas en Web
y Kestra, la revisión desplegada y la respuesta `invalid` a un contrato vacío en
el webhook dedicado (no consulta ni modifica Bitrix). Registrar el horario real
de activación y revisar 30 minutos después: admisiones, entregas, respuestas,
leads/contactos y errores. No enviar respuestas de clientes como pruebas ni
reintentar escrituras inciertas.

## Publicación y activación

Los valores por defecto quedan apagados. Este cambio no reemplaza un Flow publicado
ni activa mensajes para clientes por sí solo.

1. Subir el JSON como un **Flow nuevo** en la cuenta WhatsApp Business de Red Unisol.
   Validar la interfaz y publicar. No reutilizar los IDs del Router ni de asistencia.
2. Desplegar Web (incluida la migración) y los namespace files/flow de Marketing CRM
   por CI. Se usa el worker `edna` existente; el trabajo tiene un solo intento y
   timeout de 105 segundos, inferior a los 120 segundos de visibilidad de la cola.
3. Configurar en Web, por el circuito cifrado Git-managed:
   `EDNA_INTAKE_FLOW_ID`, `EDNA_INTAKE_START_AT`, `EDNA_INTAKE_PILOT_ID` y
   `KESTRA_EDNA_INTAKE_WEBHOOK_URL` (endpoint dedicado, HTTPS).
   Activar `EDNA_INTAKE_ENABLED` y `EDNA_INTAKE_CRM_ENABLED`.
   `EDNA_INTAKE_RECIPIENTS` permite restringir los candidatos; vacía considera
   cualquier teléfono con origen web válido, siempre con el máximo de 10. Los
   demás conservan el Router anterior. No usar el endpoint del piloto aislado.
4. Configurar en Kestra `ENV_EDNA_INTAKE_FLOW_ID`,
   `ENV_EDNA_INTAKE_CRM_ENABLED`, `ENV_EDNA_INTAKE_RECIPIENTS` y el destino manual
   existente `ENV_BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW`. El ID y la lista deben
   coincidir con Web. El webhook conserva la clave de formulario existente.
5. Probar por WhatsApp real desde el botón web y verificar el lead/contacto/chat,
   atribución, ausencia de landing/rescate y evolución de la evaluación. La respuesta
   HTTP de Edna no demuestra entrega. Verificar el cupo antes y después de UAT;
   las pruebas que reservan envíos también consumen lugares de esa tanda.

La aceptación del nuevo formulario se procesa directamente; `TEST_MODE` del piloto
anterior no se aplica. Las pruebas internas de ese piloto permanecen aisladas.
Desactivar `EDNA_INTAKE_ENABLED` vuelve las **nuevas** entradas al Router anterior;
las respuestas pendientes del nuevo Flow quedan retenidas para revisión. No
cambiar el ID para reutilizar callbacks de un Flow diferente.

## Operación y validación

### Preparación de la revisión de CUIL (28/10/2026)

Antes de desplegar el escritor, ejecutar desde los namespace files y con las
variables Bitrix operativas disponibles en el entorno:

```bash
python -m bitrix24_form_flow.form_processor.whatsapp_intake_schema
python -m bitrix24_form_flow.form_processor.whatsapp_intake_schema --apply
```

El primer comando sólo inspecciona; el segundo crea únicamente los campos y la
etapa ausentes y relee el resultado. No modifica leads, contactos, negociaciones,
robots ni etapas existentes. Un tipo incompatible exige reconciliación y detiene
la operación antes de escribir. No reintentar escrituras inciertas. El escritor
valida campos y etapas antes de aceptar mutaciones. Después se despliegan Web y
Kestra por CI; no hay que republicar el Flow ni reiniciar el cupo.

El 28/10/2026 se crearon por este procedimiento los dos campos y la etapa en
producción. La relectura confirmó ambos campos como string simple y el preview
posterior sin elementos pendientes. Es evidencia de preparación del CRM, no de
despliegue del nuevo escritor ni de rescate de formularios.

Para corregir un caso, confirmar primero el CUIL con la persona/fuente autorizada,
resolver la identidad por CUIL y recién completar el campo canónico y su contacto.
Conservar el dato inválido como evidencia; el pase al circuito automático requiere
una revisión explícita, no sucede al editar el campo inválido.

`php artisan edna:intake pilot` muestra tandas, cupos ocupados, posiciones y
los IDs de envíos/leads/contactos de los participantes, sin teléfonos ni sus hashes.
`php artisan edna:intake status [ID]` muestra sólo IDs/estados, sin CUIL, email ni
teléfono. `unknown` o `processing` interrumpido requieren buscar el
`WA_ASSISTANCE_ID` del envío en Bitrix antes de intervenir. Nunca repetir un POST
incierto. `php artisan edna:intake prune` es preview; `prune --apply` elimina las
respuestas cifradas de casos sincronizados de más de 30 días y conserva las claves
de deduplicación. Los casos pendientes de revisión no se purgan automáticamente.

### Recuperación de una falla comprobada antes de escribir en Bitrix

Bitrix devuelve `[]` cuando `crm.duplicate.findbycomm` no encuentra coincidencias.
El escritor acepta esa respuesta vacía para contactos y leads. Otras formas
inválidas se detienen antes de crear identidades; no se interpretan como ausencia.

`php artisan edna:intake recover ID` muestra el ID de solicitud, UUID de caso,
envío y admisión originales; no consulta Bitrix ni encola trabajos. Para aplicar:

1. Confirmar en Bitrix, por `UF_CRM_WA_ASSISTANCE_ID`, que el mismo UUID no tiene
   un lead ya persistido. Revisar la ejecución Kestra correspondiente al caso y
   confirmar que terminó antes de **cualquier intento** de `crm.*.add/update`.
   La ausencia de un lead por sí sola no demuestra que no hubo escritura parcial.
   Si hubo intento de escritura o evidencia incompleta, no usar recuperación:
   reconciliar el resultado existente sin repetir un POST incierto.
2. Desplegar la corrección del escritor y el comando por CI.
3. Ejecutar `php artisan edna:intake recover ID --expected-case=UUID --confirmed-no-writes --apply`
   sólo para esa falla auditada. La confirmación es del operador; el comando no
   consulta los logs ni certifica por sí solo la ausencia de escrituras.
4. Comprobar `edna:intake status ID`, el lead/contacto, la atribución y la evolución
   normal del CRM. `review` es una derivación protegida y no habilita otro reintento.

La recuperación exige `unknown` con acuse incierto, respuesta cifrada conservada,
Flow completado y correlacionado, admisión y atribución vigentes, mismo UUID y
banderas habilitadas. Bajo bloqueo de la solicitud, cambia a `pending` y encola
**sólo** `ProcessEdnaIntake` en una transacción. Un fallo al encolar revierte el
cambio. No crea un evento, envío, admisión ni cupo; conserva la respuesta y la fecha
originales. Una segunda llamada no vuelve a encolar un caso pendiente/en proceso,
y un caso `synced` es un no-op. El escritor vuelve a comprobar el UUID, teléfono,
CUIL y gestiones previas antes de persistir; un caso ya registrado no crea otro lead.

### Rescate de formularios retenidos sin lead

`php artisan edna:intake rescue ID` muestra el mismo preview. Luego del despliegue
del nuevo escritor, admite `rescue ID --expected-case=UUID --confirmed-no-writes --apply`
sólo para un `review` sin lead/contacto registrados y con un motivo conocido del
escritor anterior: respuesta inválida, identidad ambigua/conflictiva o gestión
previa. Exige la misma auditoría de ausencia de **intentos** de escritura que
`recover`; un estado `review` sin IDs no basta para demostrarlo.

El rescate encola el procesamiento del formulario cifrado original, con su fecha,
UUID, envío y admisión. No envía WhatsApp ni consume otro cupo. Una solicitud
pendiente/en proceso, incierta o ya visible como lead manual no se puede rescatar
por esta vía. El resultado manual queda en `review` con ID de lead y motivo; no se
reintenta automáticamente. Un fallo de cola revierte la transición.

Pruebas: `tests/Feature/EdnaIntakeTest.php`, suites de Router/asistencia/atribución,
`test_whatsapp_intake.py`, suites del dominio y validador de estructura Kestra.
La UAT debe cubrir las cuatro provincias del Router, todas sus situaciones,
Caja sin banco, ANSES/Bancor/otro banco, email vacío, checksum inválido, ramas
ocultas, duplicados, gestión previa, referencia ajena/vencida, cupo de 10, fallback del
ingreso 11, continuidad de participantes y rollback de reservas. La suite PHP
incluye procesos concurrentes sobre una base SQLite temporal aislada para verificar
el límite y la deduplicación; no consulta ni modifica proveedores externos.
