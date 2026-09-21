# Marketing CRM

Este dominio contiene automatizaciones del CRM y marketing comercial.

Hoy incluye la automatizacion del webhook de formulario hacia Bitrix24 y su clasificacion desacoplada por `lead_id`.

## Contenido

- `flows/edna_incoming_webhook.yaml` y `files/edna_incoming/`: interpreta entradas web y respuestas FLOW de Edna; el inbox Laravel registra envíos automáticos y correlaciona respuestas con el historial de Edna al habilitar el router. [Contrato y activación](docs/technical/EDNA_INCOMING_WEBHOOK.md).
- `flows/bitrix24_form_webhook.yaml`: flow de intake del formulario y respuesta al frontend.
- `flows/commercial_prequalification_webhook.yaml`: endpoint de pre-elegibilidad sin persistencia ni consultas externas.
- `flows/bitrix24_lead_prefill.yaml`: backfill de leads en `INGRESO (UC_5N2OEO)` con ARCA, Vimarx y BCRA; CredixSA se consulta solo para Finguru. Para Finguru sanea primero el DNI copiado como CUIL, vincula el contacto y luego ejecuta el enriquecimiento normal.
- `flows/bitrix24_lead_prefill_one.yaml`: enriquecimiento interno de un lead seleccionado; el scheduler espera hasta dos subflows en paralelo.
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
- Antes de clasificar negociaciones internas pendientes se consulta Vimarx con el CUIL actual, independientemente de la antigüedad o etapa del lead. El resultado se copia al lead y a la negociación. Las fallas se reintentan sin decidir ni distribuir; véase `docs/technical/vimarx-deal-refresh.md` (implementado, pendiente de deploy).
- Los demas origenes omiten CredixSA sin registrar errores ni reintentos por esa omision y conservan sus campos CredixSA historicos.
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
- El backfill de empleador no implementa scraping CredixSA propio: llama al flow `consulta_quiebra_credix` del dominio `analisis-credito`, que ya resuelve cache, consulta online y normalizacion.
- Aunque el dominio se llame `marketing-crm`, la integracion actual sigue siendo con Bitrix24, por eso se mantienen nombres internos `bitrix24_*` donde ya forman parte del contrato tecnico.

## Capacidad del prefill

El scheduler `bitrix24_lead_prefill` conserva `concurrency.limit: 1` y su cron
cada minuto. Selecciona hasta dos leads distintos de la primera pagina de INGRESO,
ordenados por intentos e ID, y espera ambos subflows antes de seleccionar otro lote.
Si un hijo falla, el padre espera igualmente al otro antes de fallar: las ramas
usan `transmitFailed: false` y una comprobacion final valida ambos estados. Esto
evita liberar el selector mientras el otro hijo sigue escribiendo.
No se solapan en una tanda los leads que comparten contacto o DNI (incluido el DNI
extraido del CUIL, para cubrir la resolucion de identidad Finguru).
Los duplicados conservan su lugar para tandas posteriores; no se descartan.

`bitrix24_lead_prefill_one` tiene un limite global de dos ejecuciones y no tiene
trigger. No ejecutar el hijo manualmente ni reanudar ejecuciones historicas mientras
el scheduler este activo: la exclusion por identidad pertenece al selector, no a
un bloqueo distribuido entre cualquier escritura del CRM.
Al cancelar una tanda, cancelar en cascada y comprobar que terminaron los hijos
antes de iniciar otro procesamiento. No subir la concurrencia del selector.

Las tareas Python de estos dos flows usan la imagen publica `kestrapy` fijada por
digest, con `kestra` y `requests` preinstalados y `pullPolicy: IF_NOT_PRESENT`.
No ejecutan pip durante el procesamiento. Los proveedores y sus subflows mantienen
sus consultas, cache y politica de reintentos actuales.

El padre publica `lead_ids` y `count`; cada hijo conserva `lead_id`, `action`,
`attempts` y `errors_json` para auditar el resultado individual. Para medir capacidad,
contar resultados `advanced`/`advanced_partial` de los hijos, no tandas del padre.

Para desplegar: subir primero los namespace files modificados y el hijo; publicar
el padre al final. Una ejecucion anterior del padre termina con su revision original
antes de la siguiente tanda. Para volver a procesamiento individual: restaurar el
YAML anterior del padre y esperar el cierre de la tanda en curso; el selector Python
conserva la funcion original de un solo lead.
