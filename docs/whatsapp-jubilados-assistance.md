# Jubilados Córdoba: asistencia por WhatsApp (23231 / 23081)

Implementación preparada para piloto. Definición vigente del 20/10/2026: el
**CUIL es obligatorio y el email es opcional** en las tres ramas de ayuda del Flow.
El CUIL debe tener 11 dígitos; el backend además comprueba su dígito verificador.
El backend tolera respuestas incompletas o inválidas recibidas fuera de la interfaz:
si no recupera un CUIL válido de una identidad inequívoca, deriva a revisión manual.
No inventa identidades ni rechaza comercialmente por falta de datos, y no borra un
email existente cuando la respuesta venga vacía.

## Estado de entrega y aislamiento

- Los valores por defecto quedan apagados y la allowlist vacía. La configuración
  cifrada de producción prepara un piloto interno para exactamente dos teléfonos,
  con mensajes y altas de leads de prueba habilitados. Sólo se aplica al merge y
  despliegue de Web, Infra y namespace files/flows de Kestra. No se interviene la VPS
  por SSH. La preparación externa, por sí sola, no activa mensajes ni altas CRM.
- `EDNA_ASSISTANCE_ENABLED` habilita recepción/piloto; `EDNA_ASSISTANCE_SEND_ENABLED`
  permite mensajes; `EDNA_ASSISTANCE_CRM_ENABLED` permite solicitar persistencia.
  Los tres son `false` por defecto. La lista explícita de teléfonos es obligatoria:
  **vaciarla bloquea a todos**, incluso con los flags encendidos.
- Kestra exige además su propio flag y allowlist para escribir, y el request debe
  llevar `dry_run=false`. La simulación no construye clientes ni consulta proveedores.
- El código compartido del Router conserva su recorrido y el formulario web sus
  validaciones. Los nuevos trabajos usan `edna_assistance` / `edna-assistance`, con
  reserva de 180 s y timeout máximo de 120 s. El worker Compose pertenece al perfil
  optativo `whatsapp-assistance`; no arranca en el despliegue normal.

## Piloto interno: 30 segundos y lead real de prueba

La configuración cifrada activa `EDNA_ASSISTANCE_TEST_MODE=true` y
`EDNA_ASSISTANCE_TEST_DELAY_SECONDS=30` exclusivamente para los dos teléfonos
internos autorizados. Los números y la URL autenticada se conservan sólo en los
entornos cifrados. El corte de activación es nuevo: no se rescatan entradas anteriores.
`COMPOSE_PROFILES=whatsapp-assistance` levanta el worker mediante el deploy habitual;
el workflow comprueba que esté ejecutándose.

El tester entra por el botón web y responde Córdoba / Jubilado en el Router.
Desde el envío confirmado del enlace se esperan 30 segundos. El scheduler consulta
cada cinco segundos y encola el trabajo para la hora debida; la confirmación de Edna
y la entrega pueden sumar algunos segundos. No completar el formulario para probar
el rescate: hacerlo cancela tanto el mensaje pendiente como el alta CRM posterior.
El mensaje de asistencia empieza con **[PRUEBA INTERNA]**. Se completa el Flow de
ayuda con CUIL obligatorio y email opcional.

Tras recibir una respuesta válida, el endpoint dedicado
`bitrix24_whatsapp_assistance_pilot` crea un lead nuevo:

- título **[PRUEBA WHATSAPP] Jubilados Cordoba - …**;
- campo filtrable `UF_CRM_WA_TEST=SI` y `WA_ASSISTANCE_STATE=test`;
- etapa **PRUEBAS WHATSAPP**, `UC_WA_ASSIST_TEST`;
- responsable interno Santiago (`71283`), motor `Manual` y política `No procesar`;
- CUIL/email declarados y metadatos de rama, caso y atribución para inspección.

No vincula ni modifica contactos, leads o negociaciones previos. Todas las ramas
de alta (incluido otro banco u organismo desconocido) quedan en la etapa de prueba.
La rama «volver al formulario» devuelve el enlace y no crea un lead asistido.
El prefill programado, la clasificación y el webhook lead→deal omiten la marca
de prueba incluso si el lead fuera movido a otra etapa; no hay enriquecimiento,
asignación de vendedor ni negociación automática por este recorrido.

Ambos teléfonos ya tienen historial comercial. Sólo en este modo de prueba se
omite el bloqueo por gestiones históricas de Bitrix para poder recorrer el piloto;
los recibos nuevos de formulario, la allowlist, la ventana de conversación y la
deduplicación siguen vigentes. El modo queda fijado en cada caso (`is_test`): cambiar
la configuración no convierte un caso de prueba en intake real. Web exige el
endpoint dedicado y éste exige la versión del contrato de prueba; un despliegue
parcial no recurre al intake comercial anterior.

Hay un único intento de asistencia por teléfono/canal. El Router conserva además
su cooldown de 24 horas. Para estos teléfonos internos, permite un primer ingreso
posterior al corte aunque haya un Router anterior al corte y confirmado o cerrado.
No exceptúa envíos pendientes o inciertos ni habilita nuevos ciclos después de ese
primer ingreso. No se borran historiales para repetir pruebas; ante otro
recorrido, revisar primero estados y deduplicación. El formulario web continúa su
procesamiento habitual: sus altas no son parte del intake aislado de prueba.

Fuera de `TEST_MODE`, el plazo sigue siendo 30 minutos y vuelven los bloqueos
comerciales normales. Para detener el piloto, apagar los tres flags Web y el flag
CRM de Kestra por el circuito cifrado, retirar el perfil y desplegar. No basta con
poner `TEST_MODE=false`: los casos anteriores quedan bloqueados, pero nuevos casos
pasarían al recorrido comercial si se dejan las otras compuertas habilitadas.

## Recorrido implementado

El comando sólo considera respuestas Córdoba/Jubilado con landing confirmada por
historial de Edna, posteriores al corte de activación y dentro de la ventana de
23 horas de la entrada. El plazo parte del envío confirmado de la landing, no de
la recepción del Router. Por defecto espera 30 minutos (parametrizable).

Antes de enviar consulta nuevamente Bitrix: bloquea una negociación abierta en
Ventas/Atención al Socio, un formulario no perdido de los últimos 60 días,
cualquier formulario de los últimos 30 días o un mensaje humano de asesor de los
últimos 30 días. Un error de consulta impide enviar. También bloquea nuevos envíos
al mismo destinatario/canal si ya existe un intento de envío. Una consulta suprimida
antes de enviar conserva su historial y no consume ese único envío. La reserva queda
protegida por restricciones únicas y el POST por una transición atómica de estado.
La asistencia puede enviarse fuera del horario laboral.

Para teléfonos del piloto se guarda además un recibo local de formulario aceptado,
con hash del teléfono y fecha (sin CUIL/email). Así se cancela el rescate aunque
el job del formulario todavía no haya creado el lead en Bitrix. Fuera del piloto
y con la función apagada, el formulario no agrega esta escritura.

La respuesta del Flow `1993586314642842` se valida contra canal, destinatario,
requestId, mensaje saliente confirmado y ventana de conversación. Kestra interpreta
únicamente la rama final; campos ocultos de otras ramas nunca aportan CUIL/email.

| Rama | Resultado |
|---|---|
| Caja + formulario | Landing con `cordoba_jubilado_caja` y referencia válida. |
| ANSES/Bancor + formulario | Landing con `cordoba_jubilado_anses_bancor` y referencia válida. |
| Caja + ayuda | CUIL obligatorio, email opcional; Jubilado Provincial, sin inventar banco. |
| ANSES/Bancor + ayuda | CUIL obligatorio, email opcional; Jubilado Nacional, Bancor. |
| ANSES/otro banco | Perdido por OTRO BANCO, sin negociación elegible. |
| Organismo desconocido | Revisión manual, incluso cuando informa CUIL. |

Con CUIL válido, aportado o recuperado de una identidad inequívoca por teléfono,
el lead entra al prefill existente (ARCA/Vimarx/BCRA) y su clasificación posterior.
Como resguardo para respuestas incompletas o históricas, sin CUIL queda en una etapa
manual explícita, fuera de INGRESO/PRECLASIFICACIÓN;
la falta de datos no habilita la precalificación ni crea una negociación automática.
Un asesor completa identidad/organismo y mueve el caso a INGRESO cuando corresponde.
No se inventa un nombre: la denominación se completa por el enriquecimiento existente.

El intake reutiliza un Guest activo inequívoco o un contacto identificado; consulta
también por CUIL y no elige entre identidades en conflicto. Conserva emails y teléfonos
previos, agrega un correo válido sólo si fue informado y usa una clave de caso para
resolver replays. Los formularios existentes y las identidades ambiguas van a revisión.
La campaña procede únicamente del journey vigente vinculado al destinatario/canal;
sin evidencia se usa `Sin origen`. No se recuperan campañas históricas por teléfono.
Lead y deal conservan la marca de asistencia, el Router y los datos del subflow.

## Pruebas locales sin plataformas externas

Desde la raíz:

```powershell
python kestra/tools/preview_whatsapp_assistance.py --input kestra/automations/marketing-crm/tests/fixtures/whatsapp-assistance/no-identity.json
$env:PYTHONPATH='kestra/automations/marketing-crm/files'
python -m unittest discover -s kestra/automations/marketing-crm/files/bitrix24_form_flow/tests -p 'test_*.py'
python -m unittest discover -s kestra/automations/marketing-crm/tests -p 'test_*.py'
python kestra/tools/validate_kestra.py
```

Desde `web/redunisol-web`, con dependencias de desarrollo, SQLite, intl y una
`APP_KEY` exclusivamente de prueba configurada en el entorno local:

```sh
php vendor/bin/pest tests/Feature/EdnaAssistanceTest.php tests/Feature/WhatsAppSalesContextTest.php tests/Feature/EdnaIncomingTest.php tests/Feature/EdnaRouterTest.php tests/Feature/EdnaResultsTest.php tests/Feature/EdnaFormLinksTest.php
```

Las APIs se simulan y la base es SQLite en memoria. Las fixtures son sintéticas.
El preview fuerza `dry_run=true`, aunque el archivo de entrada indique otra cosa.

## Plataformas verificadas el 20/10/2026

- **Meta:** publicado el Flow `1993586314642842`, en la cuenta WhatsApp Business
  Red Unisol `823632237115803`. Se conservan el Router `1850162769693486` y la versión
  de continuidad anterior `1806329230567984`. El JSON de la nueva versión está en
  [whatsapp-jubilados-continuidad.flow.json](whatsapp-jubilados-continuidad.flow.json).
  CUIL obligatorio y email opcional en Caja/ayuda, ANSES/Bancor/ayuda y ayuda general.
  Las condiciones simples anidadas evitan las expresiones anteriores que ocultaban
  campos en la vista previa. Los diez nombres del payload se conservan.
- **Bitrix:** creados y releídos los siete campos de asistencia en lead/contacto/deal
  y `WA_TEST` (24 campos string, simples y no obligatorios). La etapa de lead
  `UC_WA_ASSIST_REVIEW` (ID `821`, «ASISTENCIA WHATSAPP - REVISION MANUAL») es abierta,
  con orden 25. No se movieron registros ni se agregaron robots. Responsable del
  intake manual: Maru `57`. Las opciones de motor `Kestra`/`Manual`, origen `Sin origen`
  y el esquema previo de atribución ya existían. CUIL y email siguen sin ser obligatorios
  en el esquema global CRM para conservar los demás ingresos.
  Se creó además `UC_WA_ASSIST_TEST` (ID `823`, «PRUEBAS WHATSAPP», orden 26), abierta,
  sin agregar robots. El piloto asigna los leads de prueba a Santiago `71283`.
- **Edna:** canal Ventas `2423` y cascada `2557` activos y aprobados. El webhook
  «Red Unisol Main» ya recibe mensajes entrantes, exige autenticación y conserva
  Bitrix como destino principal y `https://redunisol.com.ar/api/webhooks/edna/incoming`
  como URL adicional; esta última respondió HEAD 200. No hizo falta modificarlo.
  Los Flows se envían por API con su ID publicado, dentro de la conversación abierta;
  no requieren una nueva plantilla ni un nuevo webhook para este piloto.

Meta validó el JSON sin errores. En su vista previa se comprobó que las tres ramas
de ayuda bloquean CUIL vacío y permiten CUIL de 11 dígitos con email vacío. Esto
verifica la interfaz; la entrega en un teléfono y la persistencia real siguen siendo
parte del piloto. No se enviaron mensajes ni se crearon leads de prueba.

## Activación posterior del piloto

1. Usar el Flow publicado `1993586314642842`, alineado en PHP/Python y pruebas.
   Si cambia, actualizar esas constantes y el JSON fuente antes de habilitar.
2. Configurar `ENV_BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW=UC_WA_ASSIST_REVIEW`
   por el circuito de entorno Git-managed; el intake rechaza destinos automáticos
   o finales. `BITRIX24_ASSISTANCE_REVIEW_USER_ID` admite responsable específico en
   pruebas Python; el flow usa el fallback Maru (`57`).
3. Comprobar el esquema habitual de atribución, opciones de motor comercial
   `Kestra`/`Manual` y origen `Sin origen`. `php artisan edna:assistance schema`
   sólo inspecciona; `schema --apply` crea únicamente los ocho campos faltantes
   `WA_ASSISTANCE_ID`, `WA_ASSISTANCE_STATE`, `WA_SUBFLOW`, `WA_SUBFLOW_ID`,
   `WA_ORGANISMO`, `WA_BANCO`, `WA_CONTINUIDAD`, `WA_TEST` en lead/contacto/deal. No crea etapas
   ni altera definiciones o datos preexistentes.
4. Desplegar primero migración aditiva, namespace files/flows y código con flags
   apagados. Para leer respuestas se extiende el mismo `edna_incoming_webhook`.
   El intake separado es `bitrix24_whatsapp_assistance`, con el secret de formulario
   ya existente. Su URL completa se configura en `KESTRA_EDNA_ASSISTANCE_WEBHOOK_URL`
   por el circuito de secretos; nunca poner la clave en docs o navegador.
5. Para el piloto de leads aislados, seguir la sección de 30 segundos: usar el
   endpoint `bitrix24_whatsapp_assistance_pilot`, activar `TEST_MODE` tanto en Web
   como en Kestra y configurar `ENV_BITRIX24_LEAD_STATUS_ASSISTANCE_TEST=UC_WA_ASSIST_TEST`
   y `ENV_BITRIX24_ASSISTANCE_TEST_USER_ID=71283`. Configurar un corte nuevo y teléfonos internos en
   `EDNA_ASSISTANCE_RECIPIENTS` en formato internacional, sólo dígitos. En Kestra usar su equivalente
   `ENV_EDNA_ASSISTANCE_RECIPIENTS`. No usar números de clientes ni vaciar la lista.
6. Encender recepción y envío sólo para esos teléfonos. CRM puede quedar apagado
   para preview o encendido en ambos sistemas para generar los leads de prueba.
   Levantar el worker optativo mediante el perfil Compose `whatsapp-assistance`.
   `php artisan edna:assistance poll` es preview; `poll --dispatch` reserva/encola
   sólo si los flags de piloto/envío lo permiten. El scheduler aplica la misma compuerta.
7. Revisar `php artisan edna:assistance status [CASO]`. Las respuestas quedan cifradas
   y en `crm_state=preview` mientras CRM esté apagado. Preparar el esquema y destino
   manual antes de activar ambas compuertas CRM. Para procesar un preview existente:
   `php artisan edna:assistance process CASO --dispatch`. No reenvía el Flow.

UAT: CUIL obligatorio en las tres ramas de ayuda, email omitido o inválido, email previo,
CUIL previo inequívoco, cambio de rama, formulario completado antes del rescate o
antes del intake, persona en gestión, caso duplicado, fuente conservada y omisión
de datos recibida fuera de la interfaz sin rechazo comercial. Verificar el
mensaje/Flow recibido y el lead/deal reales;
una respuesta HTTP aceptada no prueba entrega ni persistencia.

## Recuperación y retención

`unknown` significa resultado incierto y nunca habilita un segundo POST automático.
`edna:assistance reconcile CASO --dispatch` sólo consulta historial de mensajes.
Un CRM `unknown` no se reencola: inspeccionar el lead por `WA_ASSISTANCE_ID`, teléfono
y clave de caso antes de cualquier intervención. Una ejecución Kestra repetida busca
esa clave y no vuelve a crear el lead, pero no reemplaza la conciliación operativa.

`edna:assistance prune` muestra los casos cerrados elegibles a 30 días; `--apply`
borra destinatario, respuesta y texto cifrados, conservando tombstones de deduplicación.
No elimina casos inciertos. `status` no muestra teléfono, CUIL, email ni credenciales.
Desactivar los flags detiene nuevos efectos y conserva los registros para inspección.
