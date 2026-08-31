# Marketing CRM

Este dominio contiene automatizaciones del CRM y marketing comercial.

Hoy incluye la automatizacion del webhook de formulario hacia Bitrix24 y su clasificacion desacoplada por `lead_id`.

## Contenido

- `flows/bitrix24_form_webhook.yaml`: flow de intake del formulario y respuesta al frontend.
- `flows/commercial_prequalification_webhook.yaml`: endpoint de pre-elegibilidad sin persistencia ni consultas externas.
- `flows/bitrix24_lead_prefill.yaml`: backfill de leads en `INGRESO (UC_5N2OEO)` con CredixSA, ARCA, Vimarx y BCRA. Para Finguru sanea primero el DNI copiado como CUIL, vincula el contacto y luego ejecuta el enriquecimiento normal.
- `flows/bitrix24_lead_classification.yaml`: flow interno de clasificacion por `lead_id`.
- `flows/bitrix24_prequalification_cutover.yaml`: cutover manual, con dry-run, del ownership activo hacia Kestra.
- `flows/bitrix24_lead_won_deal_webhook.yaml`: receptor de `ONCRMLEADUPDATE`; clasifica `PRECLASIFICACION (NEW)` y crea negociaciones desde `RESULTADO GANADO`.
- `flows/bitrix24_catamarca_deal_qualification.yaml`: calificacion comercial definitiva y distribucion de negociaciones internas Catamarca y Cordoba; conserva el ID historico.
- `flows/bitrix24_deal_assignment_queue.yaml`: reintenta por bucket las negociaciones sin vendedor y cierra el remanente semanal con Maru.
- `flows/commercial_distribution_report_daily.yaml`: genera el Excel diario auditable de clasificacion y distribucion visible en Filament.
- `flows/bitrix24_bcra_backfill.yaml` y `flows/bitrix24_credixsa_employer_backfill.yaml`: schedulers legacy deshabilitados y reemplazados por el prefill unificado.
- `flows/bitrix24_form_persistence.yaml`: persistencia legacy deshabilitada; ya no participa de la carga web.
- `files/bitrix24_form_flow/`: namespace files Python usados por el flow.
- `files/commercial_distribution_report/`: generador del informe de trazabilidad comercial.
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
- Las fallas temporales de BCRA se persisten y reintentan con backoff durante 24 horas. Una negociación pendiente de BCRA no se rechaza ni se distribuye, y tampoco bloquea la clasificación de otras negociaciones. La política detallada vive en `docs/technical/bcra-retry-policy.md`.
- Finguru se identifica por `origenFormulario=3729`. Si DNI y CUIL contienen los mismos ocho digitos, CredixSA puede resolver el CUIL; solo se persiste cuando la respuesta es unica, contiene ese DNI y supera la validacion de checksum.
- Una identidad Finguru ambigua o no encontrada no produce un CUIL inventado ni un rechazo comercial. Queda como enriquecimiento parcial bajo la politica normal de reintentos.
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
- Las negociaciones internas Catamarca y Cordoba nacen en `PENDIENTE CALIFICACION KESTRA`, asignadas provisionalmente a Maru Lopez (`57`). La etapa programada posterior clasifica y distribuye segun el resultado y el horario.
- Cada resultado terminal publica datos auditables en la ejecucion Kestra. El reporte diario los transforma en `marketing/distribucion-negociaciones/ultimo.xlsx` y conserva una copia historica por fecha.
- El intake reutiliza una negociacion activa del mismo CUIL y bucket, registra la nueva fuente en timeline y no vuelve a ejecutar el round-robin.
- Un chat activo conserva su operador mientras siga online o durante el SLA configurado; solo vencido ese plazo vuelve a distribuirse.
- El backfill de empleador no implementa scraping CredixSA propio: llama al flow `consulta_quiebra_credix` del dominio `analisis-credito`, que ya resuelve cache, consulta online y normalizacion.
- Aunque el dominio se llame `marketing-crm`, la integracion actual sigue siendo con Bitrix24, por eso se mantienen nombres internos `bitrix24_*` donde ya forman parte del contrato tecnico.
