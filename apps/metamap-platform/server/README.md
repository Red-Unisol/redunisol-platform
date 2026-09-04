# MetaMap Platform Server

Servidor inicial para:

- recibir webhooks de MetaMap
- persistir validaciones en SQL
- exponer una API autenticada para fetchear y buscar esas validaciones
- conservar receipts recientes del webhook para debugging

## Alcance actual

Este corte deja resuelto:

- API FastAPI inicial
- persistencia durable en SQL de una proyeccion `validation` por `verification_id`
- enriquecimiento asincronico y acotado desde `resource_url` para indexar solicitud, numero de prestamo, importes, persona y documento
- lecturas servidas exclusivamente desde SQL, sin llamadas laterales a MetaMap
- cache en memoria del token OAuth de MetaMap y reintentos limitados para errores transitorios
- recuperacion al iniciar de validaciones legacy que todavia necesiten enriquecimiento
- metricas Prometheus de latencia HTTP, cola de enriquecimiento y llamadas externas
- listado, busqueda y fetch puntual de validaciones
- bootstrap de clientes autenticados por rol
- retencion de receipts/logs de MetaMap por 7 dias
- tests de API y persistencia
- eventos append-only de trazabilidad de transferencias, idempotentes por `event_id`
- consulta de trazas por solicitud, sesion, instalacion, operador y tipo de evento
- CI de validacion y build de imagen
- deploy automatico a `dev`

Todavia no resuelve:

- logica de colas
- workflow entre `validador` y `transferencias_celesol`
- locks operativos como `transfer_initiated`
- callbacks bancarios
- deploy automatico a `prod`

## Normalizacion actual de eventos

El server conserva el payload crudo mas reciente, pero ademas mantiene una normalizacion minima para consulta:

- `verification_completed` y `validation_completed` se tratan como alias terminales y se normalizan a `completed`
- `*_started` se normaliza a `started`
- `*_completed` que no sea terminal se normaliza a `in_progress`
- cualquier otro evento se normaliza a `received`

Reglas actuales:

- si se puede derivar `verification_id`, el evento actualiza o crea la validacion consolidada
- si no se puede derivar `verification_id`, el evento queda solo como receipt
- si el evento es terminal (`completed`) y no se puede derivar `verification_id`, el webhook se rechaza como payload invalido

## Configuracion

Copiar `.env.example` y ajustar:

- `METAMAP_SERVER_DATABASE_URL`
  - produccion objetivo: `postgresql+psycopg://...`
  - tests y desarrollo liviano pueden usar SQLite
- `METAMAP_SERVER_BOOTSTRAP_CLIENTS_JSON`
  - clientes iniciales con `client_id`, `client_secret` y `role`
- `METAMAP_SERVER_WEBHOOK_SECRET`
  - secreto compartido usado para validar el header `x-signature` de MetaMap
- `METAMAP_SERVER_BANK_CALLBACK_TOKEN`
  - reservado por compatibilidad para alcance futuro; hoy no se usa en la API actual
- `METAMAP_SERVER_METAMAP_CLIENT_ID`
  - opcional; si existe junto con `METAMAP_SERVER_METAMAP_CLIENT_SECRET`, el server obtiene un JWT con `POST https://api.prod.metamap.com/oauth/` y `grant_type=client_credentials` antes de leer el `resource_url`
- `METAMAP_SERVER_METAMAP_CLIENT_SECRET`
  - secreto MetaMap usado para obtener el JWT de enrichment
- `METAMAP_SERVER_METAMAP_API_TOKEN`
  - opcional; fallback legacy si no se configuran credenciales OAuth. Si existe, el server hace fetch best-effort del `resource_url` de MetaMap para extraer `request_number`, `loan_number` e `amount`
- `METAMAP_SERVER_METAMAP_AUTH_SCHEME`
  - opcional; default `Token`, usado solo con `METAMAP_SERVER_METAMAP_API_TOKEN`
- `METAMAP_SERVER_METAMAP_TIMEOUT_SECONDS`
  - timeout por intento contra OAuth o recursos MetaMap; default `10`
- `METAMAP_SERVER_METAMAP_MAX_ATTEMPTS`
  - maximo de intentos para errores de red, HTTP `429` y HTTP `5xx`; default `3`; los errores terminales como `404` no se reintentan
- `METAMAP_SERVER_METAMAP_RETRY_BACKOFF_SECONDS`
  - backoff exponencial inicial entre intentos; default `0.5`
- `METAMAP_SERVER_METAMAP_OAUTH_TOKEN_TTL_SECONDS`
  - TTL de respaldo si OAuth no informa `expires_in`; default `300`
- `METAMAP_SERVER_ENRICHMENT_WORKERS`
  - concurrencia maxima de enriquecimientos; default `4`
- `METAMAP_SERVER_ENRICHMENT_QUEUE_SIZE`
  - cantidad maxima de trabajos en espera, aparte de los workers; default `200`

Para runtime cifrado versionado en Git:

- `deploy/metamap-platform-server.dev.env.enc`
- `deploy/metamap-platform-server.prod.env.enc`

Los plaintext locales de trabajo son:

- `deploy/metamap-platform-server.dev.env`
- `deploy/metamap-platform-server.prod.env`

Los ejemplos versionados son:

- `deploy/metamap-platform-server.dev.env.example`
- `deploy/metamap-platform-server.prod.env.example`
- `deploy/docker-compose.vps.yml`

En GitHub Actions, la validacion de esos `.env.enc` usa `RUNTIME_ENV_KEY`
desde el environment `vps-infra`.

El deploy usa el mismo environment `vps-infra`, publica una imagen en GHCR y actualiza el
runtime remoto en `/opt/metamap-platform-server-dev`. Corre automaticamente cuando los
cambios del servidor o de su workflow llegan a `main` o `dev`; tambien puede ejecutarse
manualmente mediante `Deploy MetaMap Server Dev` con `workflow_dispatch`.

Para cambios coordinados con el cliente desktop, desplegar primero el servidor y distribuir
despues el ZIP de `transferencias-celesol`. Este es el runtime operativo publicado
actualmente; no existe un workflow separado de deploy a produccion.

## Auth actual

Endpoints autenticados por cliente:

- `GET /api/v1/validations`
- `GET /api/v1/validations/{verification_id}`
- `POST /api/v1/validations/{verification_id}/review`
- `GET /api/v1/internal/metamap/webhook-receipts`
- `POST /api/v1/transfer-trace-events`
- `GET /api/v1/transfer-trace-events`

Cabeceras requeridas:

- `X-Client-Id`
- `X-Client-Secret`

Endpoint publico protegido por token compartido:

- `POST /api/v1/metamap/webhooks`
  - body JSON de MetaMap con `eventName`, `resource`, `flowId`, `timestamp` y `metadata`
  - header `x-signature`
  - todos los eventos quedan logueados como receipts
  - si se puede resolver `verification_id`, el evento actualiza la validacion consolidada
  - si estan configuradas las credenciales MetaMap, el server confirma primero la persistencia y enriquece la validacion en segundo plano desde `resource_url`
  - si no hay credenciales OAuth pero si `METAMAP_SERVER_METAMAP_API_TOKEN`, usa ese token como fallback legacy

Endpoint publico de observabilidad:

- `GET /metrics`
  - formato de texto compatible con Prometheus
  - no expone payloads, credenciales ni identificadores de validaciones

## Contrato HTTP actual

### `POST /api/v1/metamap/webhooks`

Respuesta tipo:

```json
{
  "processing_status": "stored",
  "event_name": "validation_completed",
  "normalized_status": "completed",
  "verification_id": "verif-100",
  "resource_url": "https://api.getmati.com/v2/verifications/verif-100",
  "validation": {
    "verification_id": "verif-100",
    "latest_event_name": "validation_completed",
    "normalized_status": "completed",
    "request_number": "241325",
    "loan_number": "1010477",
    "amount_raw": "223.456,78",
    "amount_value": "223456.78",
    "requested_amount_raw": "123.456,78",
    "requested_amount_value": "123456.78",
    "liquidated_amount_raw": "200.000,00",
    "liquidated_amount_value": "200000.00",
    "total_amount_raw": "223.456,78",
    "total_amount_value": "223456.78",
    "event_count": 1
  }
}
```

Valores de `processing_status` actuales:

- `stored`: se persistio o actualizo la validacion
- `logged_only`: no se pudo proyectar una validacion, pero el evento quedo como receipt
- `invalid_payload`: faltan campos minimos para procesar
- `invalid_signature`: firma invalida

### `GET /api/v1/validations`

La consulta usa exclusivamente el snapshot persistido en SQL. Nunca espera ni dispara una consulta externa a MetaMap.

Filtros soportados:

- `verification_id`
- `user_id`
- `flow_id`
- `request_number`
- `loan_number`
- `amount_raw`
- `amount_value`
- `requested_amount_raw`
- `requested_amount_value`
- `liquidated_amount_raw`
- `liquidated_amount_value`
- `total_amount_raw`
- `total_amount_value`
- `event_name`
- `normalized_status`
- `q`
- `limit`
- `offset`
- `include_payload`

### `GET /api/v1/validations/{verification_id}`

Devuelve la validacion consolidada para un `verification_id`, exclusivamente desde SQL.

## Compatibilidad y consistencia

Se conservan las rutas, cabeceras de autenticacion, codigos HTTP, filtros y estructuras JSON existentes. El enriquecimiento externo pasa a ser eventualmente consistente: la respuesta del webhook puede contener inicialmente `null` en campos que solo existan en el recurso remoto, y las lecturas posteriores los exponen cuando termina el trabajo en segundo plano.

La proyeccion del recurso de MetaMap usa rutas deterministicas:

- documento: `documents[*].fields.documentNumber.value`, priorizando el documento `national-id`
- nombre: `fullName`, o `firstName` y `surname`, dentro del mismo documento
- solicitud y prestamo: claves explicitas de `metadata`, con fallback a variables de template cuyos titulos coincidan exactamente
- importes solicitado, liquidado y total: campos separados, desde `metadata` o variables de template con titulos exactos

`amount_raw` y `amount_value` se mantienen por compatibilidad y contienen, en orden de preferencia, el importe total, el liquidado o el solicitado. No se recorren claves globales genericas como `name`, `documentId` o `amount`.

Por decision de negocio, `identityStatus` no interviene en la elegibilidad actual y este cambio no modifica ese comportamiento.

### `POST /api/v1/validations/{verification_id}/review`

Marca la validacion como revisada.

Reglas actuales:

- requiere autenticacion por `X-Client-Id` y `X-Client-Secret`
- solo acepta clientes con rol `validador`
- es idempotente: si la validacion ya estaba revisada, conserva la primera marca
- devuelve `reviewed_at`, `reviewed_by_client_id` y `reviewed_by_display_name` dentro de `validation`

### `GET /api/v1/internal/metamap/webhook-receipts`

Devuelve receipts recientes de MetaMap para debugging.

### Trazabilidad de transferencias

`POST /api/v1/transfer-trace-events` acepta lotes de hasta 100 eventos autenticados con el
rol `transferencias_celesol`. La tabla `transfer_trace_events` es append-only y usa
`event_id` como clave idempotente: reenviar el mismo evento lo cuenta como duplicado sin
crear otra fila.

`GET /api/v1/transfer-trace-events` permite filtrar por `request_oid`, `session_id`,
`client_instance_id`, `operator`, `event_type`, `occurred_from` y `occurred_to`, con
paginacion `limit`/`offset`. Las fechas de ocurrencia se normalizan a UTC al ingresar.

## Estructura

```text
apps/metamap-platform/server/
  src/metamap_server/
  tests/
  Dockerfile
  pyproject.toml
```

## Ejecutar localmente

```powershell
python -m pip install -e .[dev]
uvicorn metamap_server.main:app --reload
```

## Tests

```powershell
python -m unittest discover -s tests -p "test_*.py" -t .
```
