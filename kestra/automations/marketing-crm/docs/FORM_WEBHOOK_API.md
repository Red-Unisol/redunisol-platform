# API De Carga De Formulario

## Objetivo

Este endpoint valida el payload, sincroniza el contacto y crea un lead en Bitrix24.
No consulta BCRA, ARCA, Vimarx ni CredixSA y no toma decisiones comerciales.

## Endpoint

```text
POST https://kestra.redunisol.com.ar/api/v1/main/executions/webhook/redunisol.prod.marketing-crm/bitrix24_form_webhook/<WEBHOOK_KEY>
```

El webhook se consume desde el backend Laravel. La clave no debe exponerse al navegador.

## Request

```json
{
  "full_name": "Juan Perez",
  "email": "juan.perez@example.com",
  "whatsapp": "3511234567",
  "cuil": "20-12345678-3",
  "province": "Cordoba",
  "employment_status": "Policia",
  "payment_bank": "Banco de la Nacion Argentina",
  "lead_source": "Google"
}
```

También admite campos UTM, `landing_slug`, `landing_title`, `landing_url` y `recibo_url`.

## Respuesta Exitosa

La respuesta exitosa confirma que el lead fue creado. No expresa calificación.

```json
{
  "ok": true,
  "action": "created",
  "reason": "created",
  "contact_id": "181487",
  "lead_id": "316073",
  "message": "Lead creado para clasificacion posterior."
}
```

## Respuesta De Error

```json
{
  "ok": false,
  "action": "error",
  "reason": "error",
  "contact_id": "",
  "lead_id": "",
  "message": "Falta el campo requerido: cuil."
}
```

## Integracion Web

El backend web llama por separado a este endpoint y al endpoint de preclasificación:

- carga fallida: responde error técnico al navegador
- carga exitosa y `prequalified=false`: muestra la salida comercial no aprobada
- carga exitosa y `prequalified=true`: muestra la salida con acceso a WhatsApp
- carga exitosa y preclasificación indisponible: conserva el lead y muestra una salida neutral sin WhatsApp
