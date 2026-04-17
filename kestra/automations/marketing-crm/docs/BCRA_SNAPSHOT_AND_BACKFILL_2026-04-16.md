# Snapshot BCRA Y Backfill De Leads

- fecha de relevamiento: `2026-04-16`
- fuente: working tree local de esta monorepo
- dominio: `kestra/automations/marketing-crm`

## Resumen Ejecutivo

La feature implementada agrega una integracion con la API publica de Central de Deudores del BCRA para enriquecer leads de Bitrix24 durante la clasificacion y para completar retrospectivamente el snapshot de los leads del dia.

El comportamiento nuevo queda dividido en dos partes:

- clasificacion online: al crear o reclasificar un lead, se consulta BCRA usando el CUIL y se decide si corresponde rechazo por situacion negativa
- backfill programado: un flow nuevo recorre los leads creados en el dia que todavia no tienen snapshot BCRA y les completa un campo legible, un resumen abreviado, otro raw y el timestamp separado

Ademas de decidir rechazo, la feature persiste un snapshot compacto en Bitrix24 cuando existen los tres campos Bitrix elegidos para almacenar ese resultado.

## Feature Implementada

### 1. Consulta BCRA durante la clasificacion

La clasificacion del lead ahora puede ejecutar una consulta a:

- `https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/{identificacion}`

Archivos principales:

- `files/bitrix24_form_flow/form_processor/bcra_client.py`
- `files/bitrix24_form_flow/form_processor/bcra_service.py`
- `files/bitrix24_form_flow/form_processor/business_logic.py`

El flujo funcional implementado es este:

1. se toma el CUIL normalizado del lead
2. si el lead ya tiene snapshot BCRA guardado en el campo raw, se reutiliza ese resultado y no se vuelve a consultar upstream
3. si no tiene snapshot, se consulta BCRA
4. si la respuesta es persistible, se guarda en Bitrix24
5. si el estado resultante es `NEGATIVO`, el lead se rechaza con motivo `SIT NEG BCRA`

Errores temporales y `429 rate limit` no se persisten como snapshot.

### 2. Rechazo automatico por situacion negativa

Cuando la evaluacion BCRA queda en rechazo, la clasificacion fuerza este resultado:

- `qualified = false`
- `reason = bcra_negative_situation`
- `rejection_label = SIT NEG BCRA`

La implementacion actual sigue usando un umbral de rechazo basado en entidades con `situacion = 5`, pero ahora aplicado sobre el snapshot actual del endpoint `Deudas`.

Copy actual documentado para ese rechazo:

- `El snapshot actual del BCRA supera el umbral permitido de situaciones 5.`

Este es el texto que hoy devuelve la clasificacion cuando el lead cae en `bcra_negative_situation`.

### 3. Persistencia de snapshot en Bitrix24

Se agrego soporte para guardar tres datos en el lead:

- snapshot formateado, human-readable y con saltos de linea
- resumen abreviado con conteo por situacion
- snapshot raw JSON para auditoria y reuso
- timestamp ISO 8601 en hora Argentina de consulta por separado

Variables nuevas:

- `BITRIX24_LEAD_BCRA_STATUS_FIELD`
- `BITRIX24_LEAD_BCRA_RESULT_FIELD`
- `BITRIX24_LEAD_BCRA_DATA_RAW_FIELD`
- `BITRIX24_LEAD_BCRA_CHECKED_AT_FIELD`

Si esas variables no estan configuradas:

- la clasificacion igual puede consultar BCRA y rechazar por situacion negativa
- no se persiste snapshot en Bitrix24
- el flow de backfill se auto-omite

### 4. Flow nuevo de backfill

Se agrego el flow:

- `flows/bitrix24_bcra_backfill.yaml`

Entry point nuevo:

- `files/bitrix24_form_flow/kestra_bcra_backfill_entrypoint.py`

Servicio nuevo:

- `files/bitrix24_form_flow/form_processor/bcra_service.py`

Comportamiento del backfill:

- corre por `Schedule` cada minuto
- calcula ventana desde inicio del dia hasta `now` en zona horaria Argentina `UTC-03:00`
- lista leads via `crm.lead.list`
- omite leads que ya tienen `BCRA_DATA_RAW`
- omite leads sin CUIL
- consulta BCRA para los pendientes
- persiste snapshot cuando aplica
- rechaza en Bitrix24 los leads que queden con `NEGATIVO`
- corta el lote si el upstream responde `429`

Outputs expuestos por el flow:

- `ok`
- `action`
- `processed_count`
- `populated_count`
- `rejected_count`
- `skipped_populated_count`
- `skipped_missing_cuil_count`
- `temporary_error_count`
- `rate_limited`
- `message`

## Archivos Tocados En El Tree Local

### Archivos nuevos

- `kestra/automations/marketing-crm/files/bitrix24_form_flow/form_processor/bcra_client.py`
- `kestra/automations/marketing-crm/files/bitrix24_form_flow/form_processor/bcra_service.py`
- `kestra/automations/marketing-crm/files/bitrix24_form_flow/kestra_bcra_backfill_entrypoint.py`
- `kestra/automations/marketing-crm/flows/bitrix24_bcra_backfill.yaml`

### Archivos modificados por la feature

- `kestra/automations/marketing-crm/files/bitrix24_form_flow/form_processor/bitrix_client.py`
- `kestra/automations/marketing-crm/files/bitrix24_form_flow/form_processor/business_logic.py`
- `kestra/automations/marketing-crm/files/bitrix24_form_flow/form_processor/config.py`
- `kestra/automations/marketing-crm/files/bitrix24_form_flow/form_processor/lead_service.py`
- `kestra/automations/marketing-crm/files/bitrix24_form_flow/tests/test_business_logic.py`
- `kestra/automations/marketing-crm/flows/bitrix24_form_webhook.yaml`
- `kestra/automations/marketing-crm/flows/bitrix24_lead_classification.yaml`
- `kestra/platform/infra/.env.example`
- `kestra/platform/infra/docker-compose.yml`
- `kestra/platform/infra/kestra-runtime.env.enc`
- `docs/kestra-configuration.md`

### Cambios adicionales observados en el working tree

Tambien aparecen como modificados:

- `apps/metamap-platform/server/deploy/metamap-platform-server.dev.env.enc`
- `apps/metamap-platform/server/deploy/metamap-platform-server.prod.env.enc`

En el relevamiento hecho para este documento no muestran diff funcional de contenido y parecen ser ruido de normalizacion de line endings.

## Detalle Tecnico Por Archivo

### `form_processor/bitrix_client.py`

- agrega `call_full()` para poder consumir respuestas completas de Bitrix24
- `call()` pasa a ser un wrapper sobre `call_full()`
- esto habilita paginacion y lectura de `next` en `crm.lead.list`

### `form_processor/config.py`

- agrega los dos campos opcionales de storage BCRA
- incorpora `has_bcra_storage_fields()`
- agrega helper `_optional_env()` para variables no obligatorias

### `form_processor/lead_service.py`

- agrega `update_lead_bcra_snapshot()`
- agrega `update_lead_fields()` como wrapper reutilizable
- agrega `list_leads_created_between()` con paginacion por `start/next`

### `form_processor/business_logic.py`

- inyecta dependencia opcional `bcra_client`
- consulta BCRA durante `process_form_body()`, `process_submission()` y `classify_lead()`
- reutiliza snapshot ya existente si el lead ya fue enriquecido y el raw sigue presente
- fuerza rechazo por `bcra_negative_situation` cuando corresponde

### `form_processor/bcra_client.py`

- encapsula la llamada HTTP al BCRA
- traduce respuestas `200`, `400`, `404`, `429` y errores temporales
- construye un texto formateado para columna Bitrix y un JSON raw persistible
- consulta el endpoint actual `Deudas` en lugar de `Historicas`

### `form_processor/bcra_service.py`

- centraliza `sync_lead_bcra()`
- implementa `backfill_bcra_for_today()`
- define la politica de corte por rate limiting

### Flows YAML

- `bitrix24_form_webhook.yaml` y `bitrix24_lead_classification.yaml` ahora propagan las cuatro env vars BCRA al contenedor Python
- `bitrix24_bcra_backfill.yaml` agrega el flow programado para completar snapshots del dia

### Configuracion e infra

- `.env.example` y `docker-compose.yml` quedan en cuatro variables BCRA para Bitrix
- `kestra-runtime.env.enc` mantiene la clave de `checked_at` junto con `status`, `result` y `data_raw`
- `docs/kestra-configuration.md` documenta el alta de variables y el comportamiento del backfill cuando faltan

## Cobertura De Tests

Se ampliaron los tests en:

- `files/bitrix24_form_flow/tests/test_business_logic.py`

Casos nuevos cubiertos:

- persistencia del snapshot BCRA en el flujo normal
- rechazo por `SIT NEG BCRA`
- reutilizacion de snapshot existente sin volver a consultar upstream
- backfill con skip de leads ya poblados
- corte por `rate limit`

Validacion ejecutada durante este relevamiento:

```powershell
$env:PYTHONPATH='c:\Users\Santiago\Proyectos Celesol\kestra-deploy\redunisol-kestra\kestra\automations\marketing-crm\files'
python -m unittest bitrix24_form_flow.tests.test_business_logic
```

Resultado:

- `12` tests
- `OK`

## Implicancias Operativas

Para que la feature quede completa en runtime hacen falta estos prerequisitos:

1. crear o confirmar en Bitrix24 los cuatro campos custom usados para snapshot
2. cargar sus IDs reales en `ENV_BITRIX24_LEAD_BCRA_STATUS_FIELD`, `ENV_BITRIX24_LEAD_BCRA_RESULT_FIELD`, `ENV_BITRIX24_LEAD_BCRA_DATA_RAW_FIELD` y `ENV_BITRIX24_LEAD_BCRA_CHECKED_AT_FIELD`
3. desplegar las namespace files y el flow nuevo `bitrix24_bcra_backfill`
4. validar en dev que el webhook sigue respondiendo igual hacia frontend
5. validar en dev que el lead guarda snapshot cuando hay respuesta persistible
6. validar en dev que un caso `NEGATIVO` efectivamente cae en `SIT NEG BCRA`
7. validar en dev que el backfill corre sin romperse por paginacion ni rate limiting

## Riesgos O Pendientes Detectados

- `kestra-runtime.env.enc` no solo suma claves BCRA: tambien muestra baja de variables historicas de otras integraciones. Eso conviene validarlo por separado antes de deployar.
- El flow de backfill esta configurado cada minuto. Antes de prod conviene confirmar que ese ritmo es aceptable para la cuota real del endpoint publico del BCRA.

## Conclusion

La feature implementada ya cubre ingestion online, persistencia del snapshot, reutilizacion del estado previamente guardado y backfill programado para leads del dia. A nivel de codigo, el cambio principal esta cerrado y con tests unitarios; lo que queda mas sensible para rollout es validar la configuracion real de Bitrix24, revisar el cifrado runtime y confirmar el comportamiento del scheduler frente al rate limit del BCRA.
