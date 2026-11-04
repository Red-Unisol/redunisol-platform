# WhatsApp Ventas: intake sobre el prospecto original

El contrato `whatsapp-intake-v2` admite las entradas autenticadas del canal Ventas,
incluidas las que no tienen una visita web atribuible. Mantiene el Flow v3 y los
contratos web/test anteriores para completar sus envíos pendientes. No amplía el
canal autorizado a Cobranzas ni cambia las reglas comerciales.

## Procedencia y vínculo

Web construye el contrato a partir del inbox y de un vínculo durable verificado
con el prospecto de Open Lines. El formulario público no puede proporcionar esa
procedencia ni elegir el prospecto. Además de los campos anteriores, el payload
incluye:

```text
entry_context: version=1, source=edna_authenticated,
  event_id, message_id, subject_id, received_at,
  origin=website|whatsapp_directo|unknown
crm_binding: version=1, source=bitrix_openline_session, verified=true,
  lead_id, chat_id, session_id, message_id, entry_event_id, entry_message_id,
  evidence=external_message_id
```

Los IDs de entrada del vínculo deben coincidir exactamente con el contexto y el
subject configurado. La evidencia del lado Web enlaza el mensaje externo con la
actividad/sesión nativa de Bitrix; teléfono y proximidad horaria no son prueba.
Python relee el prospecto exacto y el diálogo: mismo teléfono, chat y conector
`whatsappbyedna|1`. No compara la sesión actual con la histórica, porque el chat
puede haberse cerrado o renovado. Una conversación convertida puede conservar
el caso y su vínculo aunque el diálogo ya no tenga un lead activo.

El vínculo es obligatorio antes del procesamiento V2. Si todavía no está
disponible, Web conserva la respuesta y espera la vinculación; no debe fabricar
un segundo prospecto. El procesador V2 no utiliza `crm.lead.add` ni selecciona
un Guest por teléfono. Los contratos anteriores mantienen su comportamiento.

## Identidad y preservación

- El UUID identifica la respuesta/caso; los replays conservan el mismo prospecto.
- El contacto se resuelve por CUIL, sin heredar la identidad de otro contacto que
  use el mismo teléfono. Un CUIL/contacto previo contradictorio, un UUID anterior,
  una gestión finalizada o datos comerciales contradictorios producen revisión
  sin sobrescribir el prospecto ni crear otro.
- El resultado automático conserva INGRESO o PRECLASIFICACIÓN y el responsable.
  Un Guest vacío puede avanzar a INGRESO. El rechazo explícito y la corrección de
  CUIL sí usan sus estados terminal/de revisión correspondientes.
- Los nombres y títulos existentes se conservan durante el intake. El
  enriquecimiento normal posterior sigue usando sus fuentes habituales.
- Las relecturas previas a la escritura detectan cambios observables de la ficha.
  No equivalen a una transacción distribuida ni a una actualización condicional
  del servidor Bitrix: ante una respuesta incierta no se repite el procesamiento.

## Origen y campañas

Una entrada web resuelta mantiene su journey y sus snapshots. Una entrada directa
o de origen desconocido usa atribución `unknown`, sin journey ni campañas
inventadas, y `WA_ENTRY=whatsapp_directo`. Se preservan los campos nativos de
campaña/click/origen que ya estaban completos en el prospecto; el JSON y estado
de atribución describen el caso actual. Si una referencia web nueva contradice
la adquisición nativa existente, el caso requiere revisión sin escrituras.

`whatsapp_single_intake` es el alias neutral del subflow. La excepción de Caja
Córdoba sin banco reconoce tanto este alias como los anteriores.

## Rollout y comprobación

Publicar primero el código receptor compatible, después Web y su configuración
de admisión. Preservar las cohortes/admisiones y los callbacks de Router/v1/v2.
El parser conserva `website` por defecto y admite `sales_channel` explícito;
la admisión, el cooldown y la política de conversaciones siguen a cargo de Web.

La prueba debe comprobar el ID del prospecto de canal antes/después, el UUID,
el vínculo de actividad/sesión/mensaje y un solo prospecto por caso. Un acuse
HTTP o una ejecución SUCCESS no bastan: verificar el resultado y los IDs CRM.
Los tests con clientes inyectados cubren conflictos de identidad, Cobranzas,
replays, cambios humanos, origen directo, reintentos de lectura y escrituras
inciertas sin repetición.
