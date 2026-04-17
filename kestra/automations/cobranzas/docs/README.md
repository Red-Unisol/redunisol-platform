# Cobranzas

Dominio para automatizaciones de cobranzas y mora.

## Flows

- `bitrix_crm_negociaciones`: webhook principal que persiste las acciones futuras y programa un subflow para cada una.
- `bitrix_crm_negociaciones_execute`: subflow ejecutor que corre en la fecha exacta de cada accion programada.

## Logica actual

La automatizacion versionada en `bitrix_crm_negociaciones/**` ya no resuelve solo la etapa de promesa.
Ahora concentra la secuencia completa de negociaciones definida en `files/bitrix_crm_negociaciones/config.json`.

Arquitectura actual:

- el webhook construye un plan completo por `deal + stage` y lo guarda en KV
- el plan pasa por estado `draft` y luego `ready`
- por cada accion el webhook programa un `Subflow` con `scheduleDate`
- cada accion vive dentro del plan con su propio `status=pending|completed|cancelled|error`
- el subflow ejecutor corre en la fecha exacta planificada
- el subflow ejecutor reintenta fallos transitorios con una nueva ejecucion para releer KV y dependencias
- el subflow ejecutor limita concurrencia global a una ejecucion para bajar carreras y duplicados
- antes de actuar revalida etapa, dependencia y nueva comunicacion
- cuando una accion termina se actualiza el plan completo en KV

Stages cubiertos hoy:

- `C11:NEW`
- `C11:UC_VO2IJO`
- `C11:PREPARATION`
- `C11:EXECUTING`
- `C11:UC_6KG2Z3`

Comportamiento general:

- reacciona a cambios de etapa en Bitrix24
- ignora updates que no cambian realmente de stage
- calcula acciones futuras respetando horario habil
- persiste acciones en el KV Store de Kestra
- programa cada envio o cambio de etapa como subflow futuro en Kestra
- revalida el deal antes de cada envio o cambio de etapa
- corta la secuencia si el deal ya no sigue en la etapa esperada o si hubo nueva comunicacion despues del envio previo

## Configuracion

Configuracion runtime reutilizada:

- `envs.bitrix24_base_url`
- `envs.bitrix24_timeout_seconds`
- `secret('BITRIX24_WEBHOOK_PATH')`
- `secret('BITRIX24_CRM_NEGOCIACIONES_WEBHOOK_KEY')`
- `secret('BITRIX24_CRM_NEGOCIACIONES_APP_TOKEN')`
- `envs.bitrix24_promesa_date_field`
- `envs.bitrix24_promesa_amount_field`
- `envs.business_start_hour`
- `envs.business_start_minute`
- `envs.business_end_hour`
- `envs.business_end_minute`
- `envs.local_tz`
- `envs.edna_url`
- `envs.edna_sender`
- `envs.edna_timeout_seconds`
- `secret('EDNA_API_KEY')`

Configuracion versionada del embudo:

- `kestra/automations/cobranzas/files/bitrix_crm_negociaciones/config.json`

## Pruebas

Pruebas unitarias del dominio:

- `python -m unittest kestra.automations.cobranzas.tests.test_bitrix_crm_negociaciones`
