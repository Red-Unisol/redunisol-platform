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
El UUID, los eventos, la admisión, el slot y el Flow enviado son inmutables.
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
