# Atribución web → WhatsApp → formulario → Bitrix (tarea 23229)

## Alcance y estado

Primera entrega, preparada en Git y apagada por defecto con
`ATTRIBUTION_ENABLED=false`. No implica activación ni validación en producción.
Incluye páginas públicas, botones web de WhatsApp, Router existente, regreso por
su enlace, formulario, prospecto nuevo y creación de negociación desde ese prospecto.

No incluye anuncios directos a WhatsApp, plantillas de asesores, reconstrucción por
teléfono/CUIL, datos históricos, asistencia de jubilados ni nuevos eventos offline
para Meta/Google. No modifica el criterio de creación de prospectos del formulario.

## Decisión de atribución

La tarea original mezcla First Touch con último clic no directo. Se conservan
dos snapshots distintos:

- `first`: primera llegada observada dentro de la continuidad del navegador;
  también puede ser una llegada sin campaña conocida.
- `last`: última llegada con UTM o click ID. Una visita sin parámetros no la
  reemplaza. Las UTM internas `web_whatsapp_router` tampoco la reemplazan.

Los campos estándar UTM del NUEVO prospecto y negociación utilizan `last`.
El primer origen y ambos juegos de click IDs permanecen en `ATTR_JSON`.
Una campaña diferente crea otro snapshot; no reescribe los recorridos ya enviados
a WhatsApp. No se atribuyen todas las oportunidades futuras al primer contacto
histórico de la persona.

El origen comercial se obtiene de la UTM source con el mapa existente. Si no se
puede mapear se utiliza el valor explícito `Sin origen`; los click IDs y UTM
no reconocidas se conservan para análisis, sin inventar plataforma/campaña.
Un token resuelto acredita continuidad del recorrido, no que tenga campaña conocida.
Para medir cobertura, exigir también una fuente de adquisición identificada.

## Recorrido

1. Una respuesta pública HTML/Inertia captura UTM, gclid, gbraid, wbraid y fbclid.
   Guarda snapshots cifrados con APP_KEY en PostgreSQL. La landing almacenada excluye
   query y fragmento. Cookie propia cifrada, HttpOnly, SameSite=Lax; Secure con HTTPS.
   La captura no bloquea la página ante errores y evita cache compartida.
2. El frontend conduce los enlaces HTTPS `wa.me/<telefono>` y
   `api.whatsapp.com/send` a `/whatsapp/start`, manteniendo número y texto.
   Cubre enlaces React y CMS; clic, clic central y menú contextual.
3. El backend copia el snapshot a un recorrido independiente con referencia
   aleatoria de 96 bits (24 caracteres hex). Agrega `(ref: ...)` al texto actual y
   redirige a WhatsApp. No quita el consentimiento ni la frase del Router.
   Si falla el registro abre WhatsApp con el mensaje original.
4. Tras recibir el mensaje autenticado y clasificarlo como entrada del Router,
   se vincula una sola vez la referencia al teléfono normalizado (HMAC, sin guardar
   teléfono en esta tabla) y al canal. Otra identidad/canal no puede reasignarla.
   El registro persistente del Flow conserva `journey_id`.
5. El Router conserva sus límites y la correlación existente. La respuesta
   verificada produce el mismo enlace con las UTM de WhatsApp y agrega `ref`.
   Durante el cooldown de 24 horas no se reemplaza la atribución del Flow anterior:
   una segunda entrada no inicia ni modifica ese ciclo.
6. La sincronización existente de CRM conserva la selección y relectura del destino.
   Agrega la referencia y el snapshot a ese contacto/prospecto, sin reescribir sus
   UTM históricas, etapa, responsable o datos personales. Un nuevo resultado sin
   referencia limpia únicamente los campos de atribución agregados por esta entrega
   para no presentar el origen de otro ciclo como actual.
7. Al regresar, la referencia prevalece sobre UTM de transporte y cookies de otra
   campaña. En el formulario, el backend verifica vencimiento e identidad si la
   referencia está ligada a WhatsApp. No acepta snapshots ni banderas WA del cliente.
   Una referencia inválida, vencida o de otro teléfono queda `unresolved_ref`;
   no se intenta adivinar el origen por proximidad temporal.
8. Sin referencia explícita se usa la cookie válida. Sin ambas se conservan sólo
   las UTM actuales de adquisición (`url_only`); sin evidencia queda `unknown`.
   Las cookies Meta sin cifrar se conservan en el endpoint API: sólo se descifra
   la cookie propia, para no perder _fbp/_fbc.
9. El contrato autenticado web→Kestra transporta `attribution.version=1`.
   La creación del nuevo lead incluye snapshot y UTM resueltas. Se conserva la
   asistencia y, cuando hay respuesta verificada, el contexto WA del Router.
   El dato inicial del navegador no puede sustituir la decisión del servidor.
10. Al crear la negociación, se copian UTM y campos de atribución del lead exacto.
    Los nombres de campos de la API universal se resuelven por `upperName`.
    Una negociación ya existente no se reescribe ni se hace backfill.

La respuesta del formulario devuelve sólo las UTM resueltas para el evento
`generate_lead`; no devuelve snapshots ni click IDs. El envío CAPI existente
recibe el mismo input resuelto. No se cambian disparadores ni modelos de atribución
de las plataformas.

## Esquema CRM

En contacto, lead y deal:

- `UF_CRM_JOURNEY_ID` (string).
- `UF_CRM_ATTR_JSON` (string multilínea): first/last y, en el lead, decisión,
  asistencia y contexto del formulario.
- `UF_CRM_ATTR_STATUS` (string).
- `UF_CRM_GCLID`, `GBRAID`, `WBRAID`, `FBCLID` (todos con prefijo UF_CRM_).
- `UF_CRM_LANDING_ORIGEN` (string), `UF_CRM_FECHA_ORIGEN` (datetime).

Los campos escalares representan `last`; los dos snapshots completos quedan en JSON.
El deal también necesita los siete campos WA del Router. Los campos de origen
comercial existentes de lead/deal reciben una opción adicional `Sin origen`.
Se resuelve su ID por etiqueta, nunca se fija un ID de producción en código.

Comprobación sin cambios:

```sh
php artisan attribution:crm-schema
```

Preparación explícita de esquema, sin modificar registros CRM:

```sh
php artisan attribution:crm-schema --apply
php artisan attribution:crm-schema
```

El comando conserva los IDs y valores existentes de las enumeraciones y rechaza
esquemas incompatibles. Se puede repetir: sólo agrega faltantes. Los jobs nunca
crean campos mientras procesan consultas. El comando usa el acceso CRM configurado
de Edna; no acepta secretos por argumentos.

## Activación y reversión

1. Validar PHP, build y tests Python. Publicar namespace files de marketing-crm
   (incluido attribution.py) por el despliegue Git existente.
2. Desplegar la web con la bandera apagada y ejecutar migraciones por el circuito
   existente. La migración es aditiva y no hace backfill.
3. Preparar/verificar campos CRM y ambas opciones Sin origen. Verificar también los
   campos WA de contacto/lead con `edna:crm-fields`.
4. Habilitar ATTRIBUTION_ENABLED en el entorno cifrado versionado y desplegar por
   Git. Compose propaga la bandera a PHP y ambos workers mediante el entorno común.
5. Ejecutar UAT acotado, identificando entrada, Flow, referencia, prospecto y deal
   resultantes. No marcar terminada 23229 por el resultado de tests simulados.
6. Para revertir, apagar la bandera por Git. Conservar tablas/campos y namespace
   files para los trabajos pendientes y leads ya creados. No ejecutar down mientras
   haya código o jobs que referencien journey_id.

Las referencias vencen a los 30 días de su creación. La cookie no prolonga ese
vencimiento. Los snapshots cifrados vencidos se pueden contar/purgar con
`php artisan attribution:prune` / `php artisan attribution:prune --apply`.
El comando no toca Bitrix ni sus históricos. No se agregó un scheduler operativo.

## Validación de aceptación

Probar Córdoba/Jubilados, Catamarca/Empleado público y CABA/PFA:

- Meta → web → WhatsApp → Router → web → formulario: UTM de Meta y campaña en el
  lead nuevo y deal, WA_ASSISTED=SI, mismo journey, primer origen preservado.
- Meta → otra página → regreso directo: mantiene Meta. Luego una visita Google:
  first=Meta, last=Google; el recorrido anterior mantiene su snapshot.
- Referencia borrada, inválida y vencida: contacto permitido, sin Google inventado.
- Enlace compartido a otro teléfono: no hereda la atribución de la conversación.
- Respuesta/callback repetidos: no duplican reserva ni cambian el vínculo.
- Falla de persistencia al abrir WhatsApp: mensaje original sigue disponible.
- Cookies Meta intactas y tracking del formulario con las UTM resueltas.
- Deal preexistente o histórico: no modificado.

La suite local simula Edna, Kestra y Bitrix. No acredita entrega real de WhatsApp,
recepción de eventos publicitarios ni activación de flags en producción.
