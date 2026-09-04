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

Desde el primer fallo:

1. 5 minutos.
2. 30 minutos.
3. 2 horas.
4. Cada 6 horas.
5. Un último intento al cumplirse la ventana de 24 horas.

Si el último intento vuelve a fallar, el estado queda como `retry_exhausted`.

## Relación con la clasificación

El prefill realiza la primera consulta mediante `sync_lead_bcra`. Catamarca y
Córdoba consumen el mismo snapshot y la misma taxonomía de errores.

Cuando una negociación está en `PENDIENTE CALIFICACION KESTRA`:

- si BCRA está vigente, se aplican las reglas comerciales;
- si el reintento todavía no vence, el selector salta esa negociación y continúa
  con las siguientes;
- si el reintento vence, la negociación vuelve a consultar BCRA;
- si la consulta se recupera, la clasificación continúa en esa misma ejecución;
- mientras BCRA siga pendiente no se busca vendedor ni se transfiere el chat.

## Trazabilidad

Cada ejecución publica:

- resultado de la consulta;
- cantidad de intentos;
- próximo intento;
- fecha del snapshot;
- versión `2026-08-19-bcra-retry-v1`.

El informe de negociaciones presenta estos eventos como `Pendiente BCRA`, no como
rechazo, revisión comercial ni error técnico.

## Casos anteriores al cambio

No se reabren negociaciones históricas automáticamente. Los casos ya enviados a
revisión manual antes de esta versión deben recuperarse mediante una lista explícita
de IDs para evitar aplicar reglas nuevas a todo el histórico.
