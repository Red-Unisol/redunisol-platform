# Solicitud única dentro de WhatsApp

Definición acordada el 22/10 y ampliada el 27/10/2026: todos los segmentos del Router
actual, exclusivamente para una entrada desde el botón de la web con referencia
vigente y vinculada al teléfono/canal. CUIL obligatorio y email opcional.

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

## Persistencia y trazabilidad

El receptor autenticado Edna conserva su integración principal con Bitrix. La
recepción propia verifica requestId, mensaje saliente confirmado por historial,
teléfono, canal, Flow y ventana de conversación antes de aceptar una respuesta.
El ledger existente separa el cooldown por Flow; el nuevo intake guarda una sola
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

## Publicación y activación

Los valores por defecto quedan apagados. Este cambio no reemplaza un Flow publicado
ni activa mensajes para clientes por sí solo.

1. Subir el JSON como un **Flow nuevo** en la cuenta WhatsApp Business de Red Unisol.
   Validar la interfaz y publicar. No reutilizar los IDs del Router ni de asistencia.
2. Desplegar Web (incluida la migración) y los namespace files/flow de Marketing CRM
   por CI. Se usa el worker `edna` existente; el trabajo tiene un solo intento y
   timeout de 105 segundos, inferior a los 120 segundos de visibilidad de la cola.
3. Configurar en Web, por el circuito cifrado Git-managed:
   `EDNA_INTAKE_FLOW_ID`, `EDNA_INTAKE_START_AT` y
   `KESTRA_EDNA_INTAKE_WEBHOOK_URL` (endpoint dedicado, HTTPS).
   Activar `EDNA_INTAKE_ENABLED` y `EDNA_INTAKE_CRM_ENABLED`.
   `EDNA_INTAKE_RECIPIENTS` permite una prueba restringida; vacía habilita todos
   los teléfonos que cumplan el origen web. No usar el endpoint del piloto aislado.
4. Configurar en Kestra `ENV_EDNA_INTAKE_FLOW_ID`,
   `ENV_EDNA_INTAKE_CRM_ENABLED`, `ENV_EDNA_INTAKE_RECIPIENTS` y el destino manual
   existente `ENV_BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW`. El ID y la lista deben
   coincidir con Web. El webhook conserva la clave de formulario existente.
5. Probar por WhatsApp real desde el botón web y verificar el lead/contacto/chat,
   atribución, ausencia de landing/rescate y evolución de la evaluación. La respuesta
   HTTP de Edna no demuestra entrega. Habilitar el alcance general después de UAT.

La aceptación del nuevo formulario se procesa directamente; `TEST_MODE` del piloto
anterior no se aplica. Las pruebas internas de ese piloto permanecen aisladas.
Desactivar `EDNA_INTAKE_ENABLED` vuelve las **nuevas** entradas al Router anterior;
las respuestas pendientes del nuevo Flow quedan retenidas para revisión. No
cambiar el ID para reutilizar callbacks de un Flow diferente.

## Operación y validación

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
ocultas, duplicados, gestión previa y referencia ajena/vencida.
