# Jubilados Córdoba: asistencia por WhatsApp (23231 / 23081)

Implementación preparada para piloto. CUIL y email son **opcionales**, según la
definición posterior del usuario. Una omisión o un formato inválido no constituye
un rechazo comercial. No se inventan identidades ni correos y no se borra un email
existente porque la respuesta venga vacía.

## Estado de entrega y aislamiento

- La configuración nueva queda apagada y la allowlist vacía. No se modifica ningún
  entorno cifrado activo, configuración de Meta/Edna/Bitrix ni runtime de VPS.
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

La respuesta del Flow `1806329230567984` se valida contra canal, destinatario,
requestId, mensaje saliente confirmado y ventana de conversación. Kestra interpreta
únicamente la rama final; campos ocultos de otras ramas nunca aportan CUIL/email.

| Rama | Resultado |
|---|---|
| Caja + formulario | Landing con `cordoba_jubilado_caja` y referencia válida. |
| ANSES/Bancor + formulario | Landing con `cordoba_jubilado_anses_bancor` y referencia válida. |
| Caja + ayuda | CUIL/email opcionales; Jubilado Provincial, sin inventar banco. |
| ANSES/Bancor + ayuda | CUIL/email opcionales; Jubilado Nacional, Bancor. |
| ANSES/otro banco | Perdido por OTRO BANCO, sin negociación elegible. |
| Organismo desconocido | Revisión manual, incluso cuando informa CUIL. |

Con CUIL válido, aportado o recuperado de una identidad inequívoca por teléfono,
el lead entra al prefill existente (ARCA/Vimarx/BCRA) y su clasificación posterior.
Sin CUIL queda en una etapa manual explícita, fuera de INGRESO/PRECLASIFICACIÓN;
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

## Preparación externa para un piloto posterior

1. Marketing verifica/publica el Flow con ambos campos opcionales y confirma su ID.
   Si cambia, actualizar las constantes PHP/Python y las pruebas antes de habilitar.
2. Definir una etapa de lead manual existente y responsable. Configurar
   `ENV_BITRIX24_LEAD_STATUS_ASSISTANCE_REVIEW`; el intake rechaza destinos automáticos
   o finales. `BITRIX24_ASSISTANCE_REVIEW_USER_ID` admite responsable específico en
   pruebas Python; el flow usa el fallback Maru (`57`).
3. Comprobar el esquema habitual de atribución, opciones de motor comercial
   `Kestra`/`Manual` y origen `Sin origen`. `php artisan edna:assistance schema`
   sólo inspecciona; `schema --apply` crea únicamente los siete campos faltantes
   `WA_ASSISTANCE_ID`, `WA_ASSISTANCE_STATE`, `WA_SUBFLOW`, `WA_SUBFLOW_ID`,
   `WA_ORGANISMO`, `WA_BANCO`, `WA_CONTINUIDAD` en lead/contacto/deal. No crea etapas
   ni altera definiciones o datos preexistentes.
4. Desplegar primero migración aditiva, namespace files/flows y código con flags
   apagados. Para leer respuestas se extiende el mismo `edna_incoming_webhook`.
   El intake separado es `bitrix24_whatsapp_assistance`, con el secret de formulario
   ya existente. Su URL completa se configura en `KESTRA_EDNA_ASSISTANCE_WEBHOOK_URL`
   por el circuito de secretos; nunca poner la clave en docs o navegador.
5. En un ambiente de prueba, configurar un corte nuevo y teléfonos internos en
   `EDNA_ASSISTANCE_RECIPIENTS` en formato internacional, sólo dígitos. En Kestra usar su equivalente
   `ENV_EDNA_ASSISTANCE_RECIPIENTS`. No usar números de clientes ni vaciar la lista.
6. Encender recepción, mantener CRM apagado y habilitar envío sólo para esos teléfonos.
   Levantar el worker optativo mediante el perfil Compose `whatsapp-assistance`.
   `php artisan edna:assistance poll` es preview; `poll --dispatch` reserva/encola
   sólo si los flags de piloto/envío lo permiten. El scheduler aplica la misma compuerta.
7. Revisar `php artisan edna:assistance status [CASO]`. Las respuestas quedan cifradas
   y en `crm_state=preview` mientras CRM esté apagado. Preparar el esquema y destino
   manual antes de activar ambas compuertas CRM. Para procesar un preview existente:
   `php artisan edna:assistance process CASO --dispatch`. No reenvía el Flow.

UAT: las cuatro combinaciones de identidad, valores inválidos omitibles, email previo,
CUIL previo inequívoco, cambio de rama, formulario completado antes del rescate o
antes del intake, persona en gestión, caso duplicado, fuente conservada y omisión
de datos sin rechazo. Verificar el mensaje/Flow recibido y el lead/deal reales;
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
