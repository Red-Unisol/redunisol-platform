# API De Preclasificacion Comercial

Estado: disponible para pruebas; el formulario productivo todavia no la consume.

## Objetivo

Evaluar pre-elegibilidad usando solamente provincia, situacion laboral y banco de cobro.

El endpoint:

- no crea contactos, leads ni negociaciones
- no consulta BCRA, Vimarx, CredixSA ni ARCA
- usa las mismas reglas deterministicas que la clasificacion de leads

## Endpoint

```text
POST https://kestra.redunisol.com.ar/api/v1/main/executions/webhook/redunisol.prod.marketing-crm/commercial_prequalification_webhook/<WEBHOOK_KEY>
```

El valor de `<WEBHOOK_KEY>` se resuelve desde el secret de Kestra
`COMMERCIAL_PREQUALIFICATION_WEBHOOK_KEY` y no debe incluirse en codigo cliente versionado.

## Request

```json
{
  "province": "Catamarca",
  "employment_status": "Docente",
  "payment_bank": "Banco de la Nacion Argentina"
}
```

Los tres campos aceptan la etiqueta del catalogo o su ID de enum Bitrix. Tambien se
aceptan los aliases existentes en el formulario:

- `province`, `provincia`, `ProvinciaDeContacto`
- `employment_status`, `situacion_laboral`, `Situacion_Laboral`
- `payment_bank`, `banco_cobro`, `bancoCobroCliente`

## Respuesta Precalificada

```json
{
  "ok": true,
  "prequalified": true,
  "route_to_whatsapp": true,
  "reason": "qualified",
  "message": "La persona califica para Catamarca.",
  "rule_version": "2026-07-21"
}
```

## Respuesta No Precalificada

```json
{
  "ok": true,
  "prequalified": false,
  "route_to_whatsapp": false,
  "reason": "payment_bank_not_eligible",
  "message": "El banco \"Banco de la Nacion Argentina\" no califica para Cordoba.",
  "rule_version": "2026-07-21"
}
```

## Entrada Invalida

```json
{
  "ok": false,
  "prequalified": false,
  "route_to_whatsapp": false,
  "reason": "invalid_input",
  "message": "Falta el campo requerido: payment_bank.",
  "rule_version": "2026-07-21"
}
```

`prequalified=true` no representa una aprobacion final. La clasificacion definitiva
puede cambiar luego de consultar las fuentes externas requeridas.
