# Marketing CRM

Este dominio contiene automatizaciones del CRM y marketing comercial.

Hoy incluye la automatizacion del webhook de formulario hacia Bitrix24 y su clasificacion desacoplada por `lead_id`.

## Contenido

- `flows/bitrix24_form_webhook.yaml`: flow de intake del formulario y respuesta al frontend.
- `flows/bitrix24_lead_classification.yaml`: flow interno de clasificacion por `lead_id`.
- `flows/bitrix24_credixsa_employer_backfill.yaml`: backfill programado que enriquece leads con datos de empleador desde CredixSA.
- `files/bitrix24_form_flow/`: namespace files Python usados por el flow.
- `docs/FORM_WEBHOOK_API.md`: contrato HTTP esperado por el frontend.
- `docs/COMMERCIAL_DECISION_SPEC_2026-06-29.md`: decisiones y ambiguedades pendientes para automatizar decision comercial y derivacion.
- `tests/`: reservado para tests del dominio fuera del package si mas adelante conviene separarlos.

## Criterio

- El codigo Python vive bajo `files/bitrix24_form_flow/` para que el deploy a namespace files preserve el path esperado por Kestra.
- Los secretos y variables de entorno siguen resolviendose en Kestra, no desde Git.
- El webhook de formulario crea el lead con la enum custom `Politica procesamiento` en `No procesar` para evitar doble proceso en automatizaciones futuras.
- El backfill de empleador no implementa scraping CredixSA propio: llama al flow `consulta_quiebra_credix` del dominio `analisis-credito`, que ya resuelve cache, consulta online y normalizacion.
- Aunque el dominio se llame `marketing-crm`, la integracion actual sigue siendo con Bitrix24, por eso se mantienen nombres internos `bitrix24_*` donde ya forman parte del contrato tecnico.
