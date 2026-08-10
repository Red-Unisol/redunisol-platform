# Marketing CRM

Este dominio contiene automatizaciones del CRM y marketing comercial.

Hoy incluye la automatizacion del webhook de formulario hacia Bitrix24 y su clasificacion desacoplada por `lead_id`.

## Contenido

- `flows/bitrix24_form_webhook.yaml`: flow de intake del formulario y respuesta al frontend.
- `flows/commercial_prequalification_webhook.yaml`: endpoint de pre-elegibilidad sin persistencia ni consultas externas.
- `flows/bitrix24_lead_prefill.yaml`: backfill de leads en `INGRESO (UC_5N2OEO)` con ARCA, CredixSA, Vimarx y BCRA.
- `flows/bitrix24_lead_classification.yaml`: flow interno de clasificacion por `lead_id`.
- `flows/bitrix24_prequalification_cutover.yaml`: cutover manual, con dry-run, del ownership activo hacia Kestra.
- `flows/bitrix24_lead_won_deal_webhook.yaml`: receptor de `ONCRMLEADUPDATE`; clasifica `PRECLASIFICACION (NEW)` y crea negociaciones desde `RESULTADO GANADO`.
- `flows/bitrix24_catamarca_deal_qualification.yaml`: calificacion comercial definitiva y distribucion de negociaciones Catamarca pendientes.
- `flows/bitrix24_bcra_backfill.yaml` y `flows/bitrix24_credixsa_employer_backfill.yaml`: schedulers legacy deshabilitados y reemplazados por el prefill unificado.
- `flows/bitrix24_form_persistence.yaml`: persistencia legacy deshabilitada; ya no participa de la carga web.
- `files/bitrix24_form_flow/`: namespace files Python usados por el flow.
- `docs/README.md`: índice y política documental del dominio.
- `docs/commercial-rules/`: fuente de verdad funcional compartida.
- `docs/technical/`: arquitectura, contratos HTTP, referencia técnica y runbooks.
- `docs/archive/`, `docs/audits/` y `docs/reports/`: evidencia histórica no normativa.
- `tests/`: reservado para tests del dominio fuera del package si mas adelante conviene separarlos.

## Criterio

- El codigo Python vive bajo `files/bitrix24_form_flow/` para que el deploy a namespace files preserve el path esperado por Kestra.
- Los secretos y variables de entorno siguen resolviendose en Kestra, no desde Git.
- El webhook de formulario solo crea contacto y lead en `INGRESO (UC_5N2OEO)`; no consulta proveedores ni toma decisiones comerciales.
- La preclasificacion comercial usa el Process runner porque solo evalua reglas locales y no consulta servicios externos.
- El prefill no considera ownership. Reintenta hasta tres veces y luego mueve el lead a `PRECLASIFICACION (NEW)`, incluso si el enriquecimiento quedo parcial.
- `ONCRMLEADUPDATE` precalifica cualquier lead en `PRECLASIFICACION (NEW)` creado desde
  el corte operativo, sin usar el owner previo como compuerta; esta decision no
  interpreta BCRA.
- Todo lead nuevo creado por el intake recibe `Motor decision comercial = Kestra`.
- Rio Negro, Santa Fe y Neuquen derivan a `NEGOCIACION CON VENDEDOR (13)` cuando cumplen las reglas migradas desde Bitrix.
- Diego Frias (`ASSIGNED_BY_ID=7`) queda excluido de la precalificacion automatica.
- Bitrix conserva temporalmente un BP minimo dedicado exclusivamente al email Finguru.
- Desde `2026-08-07T12:28:19-03:00`, el webhook de actualizacion clasifica cualquier
  owner comercial y persiste `Motor decision comercial = Kestra` junto con el resultado.
- Los leads anteriores a ese corte no son reclamados ni clasificados por esta regla.
- Diego Frias (`ASSIGNED_BY_ID=7`) conserva la exclusion explicita.
- El mismo listener crea o reutiliza la negociacion cuando el lead llega a `RESULTADO GANADO`.
- Las negociaciones Catamarca con motor Kestra nacen en `PENDIENTE CALIFICACION KESTRA`, asignadas provisionalmente a Maru Lopez (`57`). La etapa programada posterior aplica BCRA y distribuye vendedor solo al aprobar.
- El backfill de empleador no implementa scraping CredixSA propio: llama al flow `consulta_quiebra_credix` del dominio `analisis-credito`, que ya resuelve cache, consulta online y normalizacion.
- Aunque el dominio se llame `marketing-crm`, la integracion actual sigue siendo con Bitrix24, por eso se mantienen nombres internos `bitrix24_*` donde ya forman parte del contrato tecnico.
