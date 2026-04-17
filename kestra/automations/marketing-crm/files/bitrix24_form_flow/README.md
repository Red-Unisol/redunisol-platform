# Formulario Web -> Bitrix24

Componente de lógica de negocio en Python para procesar el body de un formulario, sincronizar contacto y lead en Bitrix24, evaluar si la persona califica y devolver una respuesta JSON estable.

En runtime, la automatizacion queda partida en dos flows:

- intake del formulario
- clasificacion por `lead_id`

## Uso

El script principal es `bitrix24_form_flow/process_form.py`.

Lee el body desde `stdin` y escribe un JSON en `stdout`.

### Body JSON

```bash
type payload.json | python -m bitrix24_form_flow.process_form
```

Si el body es JSON, conviene definir:

```bash
set CONTENT_TYPE=application/json
```

### Body form-urlencoded

```bash
echo name=Juan+Perez^&email=juan%%40example.com^&whatsapp=3511234567^&cuil=20-12345678-3^&ProvinciaDeContacto=209^&Situacion_Laboral=1269^&bancoCobroCliente=439^&origenFormulario=2423 | python -m bitrix24_form_flow.process_form
```

Si el body es de formulario:

```bash
set CONTENT_TYPE=application/x-www-form-urlencoded
```

Si `CONTENT_TYPE` no está definido, el script intenta detectar automáticamente si el body es JSON o formulario.

## Entrada

Formato canónico recomendado:

```json
{
  "full_name": "Juan Perez",
  "email": "juan@example.com",
  "whatsapp": "3511234567",
  "cuil": "20-12345678-3",
  "province": "cordoba",
  "employment_status": "policia",
  "payment_bank": "banco_de_la_nacion_argentina",
  "lead_source": "google",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "policias-abril",
  "utm_term": "prestamo policia cordoba",
  "utm_content": "anuncio-a"
}
```

Compatibilidad legacy:

- acepta nombres de campo del HTML actual: `name`, `ProvinciaDeContacto`, `Situacion_Laboral`, `bancoCobroCliente`, `origenFormulario`
- acepta también IDs de Bitrix24 para provincia, situación laboral, banco y origen
- si llegan `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` y `utm_content`, se reenvian al lead de Bitrix en los campos estandar `UTM_*`
- si no llegan campos UTM, no se envian a Bitrix
- por ahora `landing_url`, `landing_slug` y `landing_title` no se usan en el flow de Kestra

## Salida

Siempre responde JSON. Ejemplo:

```json
{
  "ok": true,
  "qualified": true,
  "contact_id": 101,
  "lead_id": 202,
  "lead_status": "QUALIFIED",
  "action": "qualified",
  "reason": "qualified",
  "message": "La persona califica para Cordoba."
}
```

## Variables de entorno

Obligatorias:

- `BITRIX24_BASE_URL`
- `BITRIX24_WEBHOOK_PATH`
- `BITRIX24_CONTACT_CUIL_FIELD`
- `BITRIX24_LEAD_STATUS_QUALIFIED`
- `BITRIX24_LEAD_STATUS_REJECTED`
- `BITRIX24_LEAD_REJECTION_REASON_FIELD`

Opcionales para override de campos del lead:

- `BITRIX24_LEAD_PROCESSING_POLICY_FIELD`
- `BITRIX24_LEAD_PROCESSING_POLICY_SKIP`
- `BITRIX24_LEAD_PROCESSING_POLICY_PROCESS`
- `BITRIX24_LEAD_CUIL_FIELD`
- `BITRIX24_LEAD_EMPLOYMENT_STATUS_FIELD`
- `BITRIX24_LEAD_PAYMENT_BANK_FIELD`
- `BITRIX24_LEAD_PROVINCE_FIELD`
- `BITRIX24_LEAD_SOURCE_FIELD`
- `BITRIX24_LEAD_BCRA_STATUS_FIELD`
- `BITRIX24_LEAD_BCRA_RESULT_FIELD`
- `BITRIX24_LEAD_BCRA_DATA_RAW_FIELD`
- `BITRIX24_LEAD_BCRA_CHECKED_AT_FIELD`
- `BITRIX24_TIMEOUT_SECONDS`
- `BITRIX24_LEAD_UTM_SOURCE_FIELD`
- `BITRIX24_LEAD_UTM_MEDIUM_FIELD`
- `BITRIX24_LEAD_UTM_CAMPAIGN_FIELD`
- `BITRIX24_LEAD_UTM_TERM_FIELD`
- `BITRIX24_LEAD_UTM_CONTENT_FIELD`

Valores actualmente confirmados en el CRM:

- `BITRIX24_LEAD_PROCESSING_POLICY_FIELD=UF_CRM_PROCESSING_POLICY` (`Politica procesamiento`)
- `BITRIX24_LEAD_PROCESSING_POLICY_SKIP=No procesar`
- `BITRIX24_LEAD_PROCESSING_POLICY_PROCESS=Procesar`
- `BITRIX24_CONTACT_CUIL_FIELD=UF_CRM_65B7E48033FCD`
- `BITRIX24_LEAD_CUIL_FIELD=UF_CRM_1693840106704`
- `BITRIX24_LEAD_EMPLOYMENT_STATUS_FIELD=UF_CRM_1714071903`
- `BITRIX24_LEAD_PAYMENT_BANK_FIELD=UF_CRM_LEAD_1711458190312`
- `BITRIX24_LEAD_PROVINCE_FIELD=UF_CRM_64E65D2B2136C`
- `BITRIX24_LEAD_SOURCE_FIELD=UF_CRM_1722365051`
- `BITRIX24_LEAD_REJECTION_REASON_FIELD=UF_CRM_REJECTION_REASON`
- `BITRIX24_LEAD_BCRA_STATUS_FIELD=UF_CRM_BCRA_STATUS`
- `BITRIX24_LEAD_BCRA_RESULT_FIELD=UF_CRM_BCRA_RESULT`
- `BITRIX24_LEAD_BCRA_DATA_RAW_FIELD=UF_CRM_BCRA_DATA_RAW`
- `BITRIX24_LEAD_BCRA_CHECKED_AT_FIELD=UF_CRM_BCRA_CHECKED_AT`
- `BITRIX24_LEAD_UTM_SOURCE_FIELD=UTM_SOURCE`
- `BITRIX24_LEAD_UTM_MEDIUM_FIELD=UTM_MEDIUM`
- `BITRIX24_LEAD_UTM_CAMPAIGN_FIELD=UTM_CAMPAIGN`
- `BITRIX24_LEAD_UTM_TERM_FIELD=UTM_TERM`
- `BITRIX24_LEAD_UTM_CONTENT_FIELD=UTM_CONTENT`
- estado de lead para calificados: `UC_64AUC9` (`RESULTADO GANADO`)
- estado de lead para rechazados: `UC_1P8I07` (`RESULTADO PERDIDO`)

Comportamiento esperado al rechazar:

- el lead pasa al estado `RESULTADO PERDIDO`
- el motivo específico se guarda en `Motivo Rechazo` usando el enum del CRM
- si estan configurados los campos BCRA, el lead guarda un snapshot actual del BCRA en cuatro columnas:
- `UF_CRM_BCRA_STATUS`: texto formateado y legible, una entidad por linea
- `UF_CRM_BCRA_RESULT`: resumen abreviado con conteo por situacion
- `UF_CRM_BCRA_DATA_RAW`: JSON raw de la consulta actual, reutilizable para auditoria y reglas
- `UF_CRM_BCRA_CHECKED_AT`: timestamp ISO 8601 en hora Argentina de la consulta

Comportamiento esperado al crear el lead:

- el intake crea el lead con la politica `No procesar`
- el flow de clasificacion por `lead_id` puede saltarse el procesamiento si no se lo fuerza y la politica sigue distinta de `Procesar`
- si otro origen crea el lead sin completar `Politica procesamiento`, el valor vacio tambien se interpreta como `No procesar`

## Integracion con Kestra

Para usar este paquete dentro de Kestra, el adaptador recomendado es:

- `bitrix24_form_flow/kestra_form_intake_entrypoint.py`
- `bitrix24_form_flow/kestra_lead_classification_entrypoint.py`
- `bitrix24_form_flow/kestra_webhook_entrypoint.py` como wrapper backward-compatible de la ejecucion end-to-end

Los entrypoints:

- reciben `TRIGGER_BODY_JSON` o `LEAD_ID` segun el flow
- toman la configuracion Bitrix desde variables `BITRIX24_*`
- emiten `outputs` estructurados para Kestra
- mantienen la logica de negocio separada del runtime

## Módulos

- `bitrix24_form_flow/process_form.py`
  Entry point CLI. Lee el body desde `stdin`, ejecuta la lógica y escribe el JSON final.

- `bitrix24_form_flow/form_processor/business_logic.py`
  Separa intake, clasificación por `lead_id` y wrapper end-to-end.

- `bitrix24_form_flow/form_processor/input_parser.py`
  Parsea el body recibido. Soporta JSON y `application/x-www-form-urlencoded`. También traduce nombres legacy del formulario al contrato interno.

- `bitrix24_form_flow/form_processor/normalization.py`
  Normaliza CUIL, email y WhatsApp.

- `bitrix24_form_flow/form_processor/catalogs.py`
  Contiene los catálogos de provincias, situación laboral, bancos y origen. Resuelve valores semánticos o IDs legacy a un modelo interno.

- `bitrix24_form_flow/form_processor/config.py`
  Carga la configuración desde variables de entorno.

- `bitrix24_form_flow/form_processor/qualification.py`
  Implementa la lógica pura de calificación, separada de Bitrix24.

- `bitrix24_form_flow/form_processor/bcra_client.py`
  Consulta el endpoint actual `Deudas` del BCRA y arma el snapshot formateado + raw.

- `bitrix24_form_flow/form_processor/bitrix_client.py`
  Wrapper de llamadas HTTP a Bitrix24.

- `bitrix24_form_flow/form_processor/contact_service.py`
  Busca el contacto por CUIL y hace create/update según corresponda.

- `bitrix24_form_flow/form_processor/lead_service.py`
  Crea el lead con la politica `No procesar`, reconstruye un lead por `lead_id` y actualiza su estado final en Bitrix24.

- `bitrix24_form_flow/form_processor/result.py`
  Genera la respuesta JSON final de éxito o error.

- `bitrix24_form_flow/form_processor/logger.py`
  Escribe logs operativos a `stderr`.

- `bitrix24_form_flow/tests/test_business_logic.py`
  Tests unitarios y de orquestación con cliente Bitrix falso.

## Ejecutar tests

```bash
python -m unittest discover -s bitrix24_form_flow/tests -p "test_*.py"
```

## Observaciones

- El formulario no necesita conocer campos `UF_CRM_*` ni estados internos de Bitrix.
- Los mapeos a Bitrix quedan centralizados en el backend.
- El script no expone HTTP; sólo procesa un body y devuelve JSON.
