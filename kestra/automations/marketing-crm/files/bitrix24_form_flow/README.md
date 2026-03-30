# Formulario Web -> Bitrix24

Componente de lógica de negocio en Python para procesar el body de un formulario, sincronizar contacto y lead en Bitrix24, evaluar si la persona califica y devolver una respuesta JSON estable.

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
  "lead_source": "google"
}
```

Compatibilidad legacy:

- acepta nombres de campo del HTML actual: `name`, `ProvinciaDeContacto`, `Situacion_Laboral`, `bancoCobroCliente`, `origenFormulario`
- acepta también IDs de Bitrix24 para provincia, situación laboral, banco y origen

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

- `BITRIX24_LEAD_CUIL_FIELD`
- `BITRIX24_LEAD_EMPLOYMENT_STATUS_FIELD`
- `BITRIX24_LEAD_PAYMENT_BANK_FIELD`
- `BITRIX24_LEAD_PROVINCE_FIELD`
- `BITRIX24_LEAD_SOURCE_FIELD`
- `BITRIX24_TIMEOUT_SECONDS`

Valores actualmente confirmados en el CRM:

- `BITRIX24_CONTACT_CUIL_FIELD=UF_CRM_65B7E48033FCD`
- `BITRIX24_LEAD_CUIL_FIELD=UF_CRM_1693840106704`
- `BITRIX24_LEAD_EMPLOYMENT_STATUS_FIELD=UF_CRM_1714071903`
- `BITRIX24_LEAD_PAYMENT_BANK_FIELD=UF_CRM_LEAD_1711458190312`
- `BITRIX24_LEAD_PROVINCE_FIELD=UF_CRM_64E65D2B2136C`
- `BITRIX24_LEAD_SOURCE_FIELD=UF_CRM_1722365051`
- `BITRIX24_LEAD_REJECTION_REASON_FIELD=UF_CRM_REJECTION_REASON`
- estado de lead para calificados: `UC_64AUC9` (`RESULTADO GANADO`)
- estado de lead para rechazados: `UC_1P8I07` (`RESULTADO PERDIDO`)

Comportamiento esperado al rechazar:

- el lead pasa al estado `RESULTADO PERDIDO`
- el motivo específico se guarda en `Motivo Rechazo` usando el enum del CRM

## Integracion con Kestra

Para usar este paquete dentro de Kestra, el adaptador recomendado es:

- `bitrix24_form_flow/kestra_webhook_entrypoint.py`

Ese script:

- recibe `TRIGGER_BODY_JSON` desde el flow
- toma la configuracion Bitrix desde variables `BITRIX24_*`
- emite `outputs` estructurados para Kestra
- mantiene la logica de negocio separada del runtime

## Módulos

- `bitrix24_form_flow/process_form.py`
  Entry point CLI. Lee el body desde `stdin`, ejecuta la lógica y escribe el JSON final.

- `bitrix24_form_flow/form_processor/business_logic.py`
  Orquesta el flujo completo: parseo, normalización, upsert de contacto, creación de lead, calificación y cambio de estado.

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

- `bitrix24_form_flow/form_processor/bitrix_client.py`
  Wrapper de llamadas HTTP a Bitrix24.

- `bitrix24_form_flow/form_processor/contact_service.py`
  Busca el contacto por CUIL y hace create/update según corresponda.

- `bitrix24_form_flow/form_processor/lead_service.py`
  Crea el lead y actualiza su estado final en Bitrix24.

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
