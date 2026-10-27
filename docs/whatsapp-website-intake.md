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

El backend exige CUIL de 11 dígitos con checksum válido antes de consultar el CRM.
Un callback inválido queda para revisión. «Otra provincia», «otra situación» o
datos de organismo/banco desconocidos generan un lead manual con CUIL y sin
precalificación automática. Las respuestas completas reutilizan las reglas
comerciales vigentes; este desarrollo no cambia elegibilidad ni distribución.

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

El webhook `bitrix24_whatsapp_intake` reutiliza la búsqueda por CUIL/teléfono y
el escritor del intake asistido. Actualiza un Guest activo inequívoco, preserva
emails existentes y vincula el contacto. Conflictos de identidad, formularios ya
completos o gestiones abiertas en Ventas/Atención al Socio quedan para revisión,
sin sobrescribir la gestión. Una respuesta repetida no crea un segundo lead.

Se reutilizan los campos de asistencia existentes; no se hacen obligatorios
globalmente en Bitrix. `WA_FLOW=web_whatsapp_intake`,
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

`php artisan edna:intake pilot` muestra tandas, cupos ocupados, posiciones y
los IDs de envíos/leads/contactos de los participantes, sin teléfonos ni sus hashes.
`php artisan edna:intake status [ID]` muestra sólo IDs/estados, sin CUIL, email ni
teléfono. `unknown` o `processing` interrumpido requieren buscar el
`WA_ASSISTANCE_ID` del envío en Bitrix antes de intervenir. Nunca repetir un POST
incierto. `php artisan edna:intake prune` es preview; `prune --apply` elimina las
respuestas cifradas de casos sincronizados de más de 30 días y conserva las claves
de deduplicación. Los casos pendientes de revisión no se purgan automáticamente.

Pruebas: `tests/Feature/EdnaIntakeTest.php`, suites de Router/asistencia/atribución,
`test_whatsapp_intake.py`, suites del dominio y validador de estructura Kestra.
La UAT debe cubrir las cuatro provincias del Router, todas sus situaciones,
Caja sin banco, ANSES/Bancor/otro banco, email vacío, checksum inválido, ramas
ocultas, duplicados, gestión previa, referencia ajena/vencida, cupo de 10, fallback del
ingreso 11, continuidad de participantes y rollback de reservas. La suite PHP
incluye procesos concurrentes sobre una base SQLite temporal aislada para verificar
el límite y la deduplicación; no consulta ni modifica proveedores externos.
