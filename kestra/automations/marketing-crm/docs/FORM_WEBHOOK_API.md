# API Formulario -> Kestra

## Objetivo

Este endpoint recibe los datos del formulario, sincroniza contacto y lead en Bitrix24 y responde si la persona califica o no.
Internamente el dominio hoy esta partido en un flow publico de intake y un flow interno de clasificacion por `lead_id`, pero el contrato HTTP hacia frontend se mantiene estable.

El frontend solo necesita:

- enviar un `POST` JSON
- leer la respuesta
- redirigir según `qualified`

## Endpoint

```text
POST http://kestra.redunisol.com.ar/api/v1/main/executions/webhook/redunisol/bitrix24_form_webhook/<WEBHOOK_KEY>
```

`<WEBHOOK_KEY>` debe obtenerse desde el secret configurado en Kestra para este flow. No hardcodearlo en frontend ni versionarlo en Git.

## Headers

```http
Content-Type: application/json
```

## Body Esperado

Ejemplo:

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

Campos:

- `full_name`: nombre completo
- `email`: email valido
- `whatsapp`: telefono argentino; puede venir como `3511234567` o formato internacional
- `cuil`: puede venir con o sin guiones
- `province`: nombre semantico de la provincia
- `employment_status`: nombre semantico de la situacion laboral
- `payment_bank`: nombre semantico del banco
- `lead_source`: origen del lead

## Valores Recomendados

`province`

- `Cordoba`
- `Rio Negro`
- `Neuquen`
- `Catamarca`
- `Santa Fe`
- `La Rioja`
- `Buenos Aires`

`employment_status`

- `Empleado Publico Provincial`
- `Empleado Publico Nacional`
- `Empleado Publico Municipal`
- `Empleado Privado`
- `Policia`
- `Jubilado Provincial`
- `Jubilado Nacional`
- `Jubilado Municipal`
- `Autonomo Independiente`
- `Monotributista`
- `Pensionado`
- `Beneficiario de Plan Social`

`lead_source`

- `Google`
- `Facebook`
- `Instagram`
- `WhatsApp`
- `E Mail`
- `YouTube`

## Respuesta Exitosa

### Caso aprobado

```json
{
  "ok": true,
  "action": "qualified",
  "reason": "qualified",
  "lead_id": "316073",
  "message": "La persona califica para Cordoba.",
  "qualified": true,
  "contact_id": "181487",
  "lead_status": "UC_64AUC9"
}
```

### Caso rechazado

```json
{
  "ok": true,
  "action": "rejected",
  "reason": "province_not_eligible",
  "lead_id": "316065",
  "message": "La provincia \"Buenos Aires\" no califica.",
  "qualified": false,
  "contact_id": "181479",
  "lead_status": "UC_1P8I07"
}
```

## Respuesta De Error

Si faltan datos o el payload es invalido, el endpoint responde JSON estable:

```json
{
  "ok": false,
  "action": "error",
  "reason": "not_evaluated",
  "lead_id": "",
  "message": "Falta el campo requerido: cuil.",
  "qualified": false,
  "contact_id": "",
  "lead_status": ""
}
```

## Regla De Integracion Para Frontend

- si `ok` es `false`, tratarlo como error de integracion o validacion
- si `ok` es `true` y `qualified` es `true`, redirigir al flujo aprobado
- si `ok` es `true` y `qualified` es `false`, redirigir al flujo rechazado

## Ejemplo Con `fetch`

```js
const response = await fetch(
  "http://kestra.redunisol.com.ar/api/v1/main/executions/webhook/redunisol/bitrix24_form_webhook/<WEBHOOK_KEY>",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      full_name: "Juan Perez",
      email: "juan.perez@example.com",
      whatsapp: "3511234567",
      cuil: "20-12345678-3",
      province: "Cordoba",
      employment_status: "Policia",
      payment_bank: "Banco de la Nacion Argentina",
      lead_source: "Google"
    })
  }
);

const data = await response.json();

if (!data.ok) {
  console.error("Error de integracion:", data.message);
} else if (data.qualified) {
  window.location.href = "/aprobado";
} else {
  window.location.href = "/rechazado";
}
```
