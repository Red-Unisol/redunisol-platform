# Política de reintentos BCRA

## Objetivo

Una indisponibilidad temporal del BCRA no es una decisión comercial. El caso debe
permanecer pendiente, sin rechazo ni distribución, hasta obtener un snapshot válido
o agotar una ventana controlada de reintentos.

## Fuente de estado

El estado vive en los mismos campos BCRA del lead de Bitrix. El campo raw conserva
un JSON con:

- `outcome`
- `queried_at`
- `http_status`
- `identification`
- `message`
- `retry.attempts`
- `retry.first_failed_at`
- `retry.last_failed_at`
- `retry.next_retry_at`
- `retry.expires_at`
- `retry.not_before`: mínimo impuesto por `Retry-After`, si BCRA lo informa

Esto permite que cualquier ejecución posterior retome el mismo ciclo sin depender
de la memoria de una ejecución Kestra.

## Estados normalizados

- `ok`: snapshot disponible y apto para aplicar reglas comerciales.
- `not_found`: respuesta definitiva sin información; pasa a revisión manual.
- `invalid_identification`: identificación inválida; pasa a revisión manual.
- `temporary_error`: falla recuperable con próximo intento programado.
- `rate_limited`: límite temporal del servicio con próximo intento programado.
- `retry_scheduled`: todavía no llegó la hora del siguiente intento.
- `retry_exhausted`: transcurrieron 24 horas sin una respuesta utilizable; pasa a
  revisión manual y nunca se rechaza por la falla técnica.

## Calendario

Cada consulta reintenta hasta dos veces adicionales ante cortes de conexión o
HTTP 5xx, con pausas de 1 y 3 segundos. Los tres intentos comparten un presupuesto
de 20 segundos. No se reintentan inmediatamente HTTP 400, 404 o 429 ni una respuesta
que indique `Retry-After`.

Dentro de la ventana comercial continua de lunes 00:00 a viernes 17:00, los ciclos
fallidos se reprograman con esperas de **1, 5 y 15 minutos**, manteniendo 15 minutos
para los siguientes ciclos. Se usa la misma zona horaria y configuración de ventana
que la distribución. Las consultas son secuenciales y los lotes tienen tamaño y
presupuesto de tiempo acotados.

Fuera de esa ventana se conserva la política conservadora: 5 minutos, 30 minutos,
2 horas y luego cada 6 horas. Un `Retry-After` válido (segundos o fecha HTTP) siempre
se respeta, aunque supere los 15 minutos. HTTP 429 interrumpe el lote actual para
no seguir consultando al proveedor en esa ejecución.

Las esperas antiguas de 2/6 horas se consideran vencidas al alcanzar la demora de
la nueva política dentro de la ventana comercial, calculada desde el último fallo.
No se reinician el contador de intentos ni la ventana de 24 horas. No hace falta
modificar los casos existentes para recuperar los que siguen pendientes.

Se conserva un último intento al vencer la ventana de 24 horas (respetando
`Retry-After`). Si vuelve a fallar, el estado queda como `retry_exhausted` y pasa a
revisión manual.

## Relación con la clasificación

El prefill realiza la primera consulta mediante `sync_lead_bcra`. Catamarca y
Córdoba consumen el mismo snapshot y la misma taxonomía de errores.

Cuando una negociación está en `PENDIENTE CALIFICACION KESTRA`:

- si BCRA está vigente, se aplican las reglas comerciales;
- si el reintento todavía no vence, el selector salta esa negociación y continúa
  con las siguientes;
- si el reintento vence, la negociación vuelve a consultar BCRA;
- si la consulta se recupera, la clasificación continúa en esa misma ejecución;
- el clasificador procesa hasta cinco casos elegibles por ejecución, de forma
  secuencial y sin volver a intentar el mismo ID dentro del lote;
- antes de cada caso vuelve a verificar su etapa para evitar reasignaciones;
- mientras BCRA siga pendiente no se busca vendedor ni se transfiere el chat.

## Trazabilidad

Cada ejecución publica:

- resultado de la consulta;
- cantidad de intentos;
- próximo intento;
- fecha del snapshot;
- `events_json`: traza individual de cada negociación del lote;
- `event_count` y `deferred_count`: casos tratados y seleccionados que se difirieron.

El informe de negociaciones presenta estos eventos como `Pendiente BCRA`, no como
rechazo, revisión comercial ni error técnico.

## Casos anteriores al cambio

No se reabren negociaciones históricas automáticamente. Los casos ya enviados a
revisión manual antes de esta versión deben recuperarse mediante una lista explícita
de IDs para evitar aplicar reglas nuevas a todo el histórico.
