# Intake unificado de WhatsApp Ventas

## Alcance y escritor único

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

La atribución web resuelta conserva su journey y campañas. Los ingresos directos
se registran como `whatsapp_directo`; una referencia no verificable queda sin
atribución confirmada. No se inventan journeys ni UTM. El contexto se congela por
caso, sin consultar el último contexto mutable del teléfono al recibir la respuesta.

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

Ese bloqueo se produce antes de crear contactos o actualizar el prospecto. Su
acuse contiene el ID del prospecto original verificado, aunque no haya escrituras.
Para recuperar una respuesta ya auditada se puede usar:

```text
php artisan edna:intake rescue REQUEST_ID --expected-case=CASE_UUID --expected-lead=LEAD_ID --confirmed-no-writes --apply
```

El operador debe comprobar la ausencia de escrituras CRM antes de aplicar. Para
este motivo concreto el comando exige contrato V2, prueba de origen verificada,
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
4. Verificar configuración, migraciones, workers y páginas públicas. La lectura
   de una conversación real permite comprobar los IDs de origen sin enviar nada.
5. Comprobar, cuando el saldo permita tráfico auténtico, una respuesta que actualice
   el prospecto original, sin otro lead, y termine el recorrido comercial.

Rollback: `EDNA_INTAKE_ENTRY_SCOPE=website` restringe las nuevas entradas; conservar
el consumidor y las tablas capaces de finalizar los casos V2 ya abiertos.
No borrar bindings, respuestas, admisiones ni contadores; no apagar recepción o
CRM para ejecutar el rollback.
