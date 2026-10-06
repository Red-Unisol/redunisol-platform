# Refresh Vimarx antes de clasificar negociaciones

Estado: **implementado, pendiente de deploy**. Fecha: 2026-09-11.

## Alcance

El flow `bitrix24_catamarca_deal_qualification` consulta Vimarx antes de decidir
sobre cada negociación interna pendiente de Catamarca o Córdoba. El prefill de
leads continúa funcionando como antes; el refresh no depende de haber pasado por él,
de la fecha de creación del lead ni de su estado INGRESO, NEW o CONVERTED.

Se consulta nuevamente en cada ejecución que alcanza la clasificación y está
habilitada para reintentar. No se considera vigente un resultado solo porque el
lead es reciente, porque ya contiene JSON o porque otra negociación lo consultó.

La política comercial está en
[`DEAL_CLASSIFICATION.md`](../commercial-rules/DEAL_CLASSIFICATION.md#actualización-de-datos-vimarx-antes-de-decidir).
BCRA se resuelve primero. Si queda pendiente, se posterga también Vimarx.

## Persistencia y coherencia

Se usa el servicio Vimarx compartido y los campos Bitrix existentes, sin crear
campos nuevos. Se actualizan Es socio, número de socio, cantidad/detalle/JSON de
créditos activos en el lead, y sus equivalentes en la negociación. La negociación
recibe también el CUIL consultado y Socio nuevo, derivado de la afiliación actual.

El JSON conserva el contrato previo y agrega:

- `queried_cuil`: CUIL normalizado consultado;
- `queried_at`: fecha de inicio de la consulta/intento;
- `qualification_refresh.deal_id`;
- `qualification_refresh.outcome`;
- `qualification_refresh.checked_at`;
- `qualification_refresh.attempts`;
- `qualification_refresh.next_retry_at`.

Una respuesta exitosa sin socio devuelve `not_found`, Es socio = No y cero
créditos. Un error devuelve Es socio = Desconocido y vacía número/cantidad anterior;
Socio nuevo también se vacía. El JSON de error nunca habilita las reglas comerciales.

El estado de reintentos se lee del JSON de **la negociación** y se vincula al ID de
esa negociación y al CUIL actual. Un prefill posterior sobre el lead o una segunda
negociación no heredan ni borran ese ciclo. Un cambio de CUIL invalida la espera.

Antes de escribir se releen identidad y etapa. Si cambió el CUIL, el lead vinculado
o la etapa pendiente, se interrumpe el procesamiento para reevaluar. Una falla de
persistencia Bitrix también aborta la clasificación. Las dos escrituras no son una
transacción: si falla la segunda, el próximo intento vuelve a consultar y sincronizar.

## Recuperación y trazabilidad

| Resultado | Tratamiento |
|---|---|
| `member` / `not_found` | Aplicar reglas comerciales con la respuesta actual. |
| `retry_scheduled` | Conservar etapa pendiente, sin responsable nuevo ni transferencia de chat. |
| `retry_exhausted` | Revisión manual con motivo específico. |
| `missing_cuil` | Revisión manual; no consultar con menos de 11 dígitos. |
| `configuration_error` | Revisión manual; nunca omitir silenciosamente el refresh. |

Además de los reintentos HTTP existentes, el scheduler admite tres intentos de
refresh: el primero, otro programado a los 5 minutos y un tercero a los 15 minutos
del segundo. El selector omite las negociaciones cuya espera no venció y sigue
buscando en la cola. El ciclo se conserva entre ejecuciones Kestra.

Las ejecuciones publican `vimarx_refresh_outcome`, `vimarx_snapshot_checked_at`,
`vimarx_retry_attempts` y `vimarx_next_retry_at`. El informe muestra
**Pendiente Vimarx** para las esperas, distinguiéndolas de BCRA y de los rechazos.

## Configuración y puesta en marcha

El task de clasificación usa los secretos existentes
`DEVEXPRESS_EVALUATE_API_BASE_URL` y `DEVEXPRESS_EVALUATE_API_BEARER_TOKEN`,
más `vimarx_timeout_seconds` y `vimarx_verify_tls`, ya utilizados por el prefill.
Los mapeos de campos Vimarx del lead también se pasan explícitamente al flow.

Validar los tests de Marketing CRM y el dry-run, integrar el PR y desplegar el
dominio por el workflow Git-managed. Verificar después una ejecución nueva:
identidad y JSON iguales en lead/deal, resultado del refresh visible y decisión
coherente con ese resultado.

Este cambio no reprocesa negociaciones cerradas, en revisión manual ni en cola de
distribución. Tampoco agrega un listener independiente para la edición de CUIL.
Si un CUIL se completa antes de la clasificación pendiente, el refresh lo utiliza.
Para recuperar casos que ya salieron de esa etapa se necesita una lista explícita
de IDs y una intervención autorizada. En un caso con reintentos agotados, esa
intervención debe reiniciar también `qualification_refresh` del JSON de la negociación.

La información de cuota social AMEJUCA sigue pendiente de una fuente estructurada;
consultar nuevamente afiliación y préstamos no resuelve esa dependencia.
