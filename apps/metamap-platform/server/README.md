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
- enriquecimiento opcional desde `resource_url` para indexar solicitud, numero de prestamo e importe
- listado, busqueda y fetch puntual de validaciones
- bootstrap de clientes autenticados por rol
- retencion de receipts/logs de MetaMap por 7 dias
- tests de API y persistencia
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

El deploy automatico `dev` usa el mismo environment `vps-infra`, publica una
imagen en GHCR y actualiza el runtime remoto en `/opt/metamap-platform-server-dev`.

## Auth actual

Endpoints autenticados por cliente:

- `GET /api/v1/validations`
- `GET /api/v1/validations/{verification_id}`
- `GET /api/v1/internal/metamap/webhook-receipts`

Cabeceras requeridas:

- `X-Client-Id`
- `X-Client-Secret`

Endpoint publico protegido por token compartido:

- `POST /api/v1/metamap/webhooks`
  - body JSON de MetaMap con `eventName`, `resource`, `flowId`, `timestamp` y `metadata`
  - header `x-signature`
  - todos los eventos quedan logueados como receipts
  - si se puede resolver `verification_id`, el evento actualiza la validacion consolidada
  - si estan configuradas las credenciales MetaMap, el server obtiene un JWT y enriquece la validacion desde `resource_url`
  - si no hay credenciales OAuth pero si `METAMAP_SERVER_METAMAP_API_TOKEN`, usa ese token como fallback legacy

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
    "amount_raw": "123.456,78",
    "amount_value": "123456.78",
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

Filtros soportados:

- `verification_id`
- `user_id`
- `flow_id`
- `request_number`
- `loan_number`
- `event_name`
- `normalized_status`
- `q`
- `limit`
- `offset`
- `include_payload`

### `GET /api/v1/validations/{verification_id}`

Devuelve la validacion consolidada para un `verification_id`.

### `GET /api/v1/internal/metamap/webhook-receipts`

Devuelve receipts recientes de MetaMap para debugging.

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
