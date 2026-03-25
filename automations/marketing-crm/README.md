# Bitrix24 Automation

Este dominio contiene la automatizacion del webhook de formulario hacia Bitrix24.

## Contenido

- `flows/bitrix24_form_webhook.yaml`: flow funcional del dominio.
- `files/bitrix24_form_flow/`: namespace files Python usados por el flow.
- `docs/FORM_WEBHOOK_API.md`: contrato HTTP esperado por el frontend.
- `tests/`: reservado para tests del dominio fuera del package si mas adelante conviene separarlos.

## Criterio

- El codigo Python vive bajo `files/bitrix24_form_flow/` para que el deploy a namespace files preserve el path esperado por Kestra.
- Los secretos y variables de entorno siguen resolviendose en Kestra, no desde Git.
