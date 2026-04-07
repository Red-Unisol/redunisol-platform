# MetaMap Platform Server

Servidor inicial para el flujo:

- MetaMap -> `validador`
- `validador` -> `transferencias_celesol`
- `transferencias_celesol` -> banco
- callbacks del banco -> servidor

## Alcance actual

Este scaffold deja resuelto:

- API FastAPI inicial
- workflow base persistente en SQL
- colas por rol
- transiciones `approved`, `rejected` y `transfer_submitted`
- callbacks bancarios con idempotencia basica
- bootstrap de clientes autenticados por rol
- tests de workflow
- CI de validacion y build de imagen

Todavia no resuelve:

- WebSockets
- leasing/reintentos de cola
- deploy automatico

## Configuracion

Copiar `.env.example` y ajustar:

- `METAMAP_SERVER_DATABASE_URL`
  - produccion objetivo: `postgresql+psycopg://...`
  - tests y desarrollo liviano pueden usar SQLite
- `METAMAP_SERVER_BOOTSTRAP_CLIENTS_JSON`
  - clientes iniciales con `client_id`, `client_secret` y `role`
- `METAMAP_SERVER_WEBHOOK_TOKEN`
  - token compartido para MetaMap
- `METAMAP_SERVER_BANK_CALLBACK_TOKEN`
  - token compartido para callbacks bancarios

Para runtime cifrado versionado en Git:

- `deploy/metamap-platform-server.dev.env.enc`
- `deploy/metamap-platform-server.prod.env.enc`

Los plaintext locales de trabajo son:

- `deploy/metamap-platform-server.dev.env`
- `deploy/metamap-platform-server.prod.env`

Los ejemplos versionados son:

- `deploy/metamap-platform-server.dev.env.example`
- `deploy/metamap-platform-server.prod.env.example`

## Auth actual

Endpoints de cliente:

- `GET /api/v1/queues/{role}`
- `GET /api/v1/cases/{case_id}`
- `POST /api/v1/cases/{case_id}/actions`

Cabeceras requeridas:

- `X-Client-Id`
- `X-Client-Secret`

Endpoints publicos protegidos por token compartido:

- `POST /api/v1/metamap/webhooks`
  - `X-Metamap-Webhook-Token`
- `POST /api/v1/bank/callbacks/...`
  - `X-Bank-Callback-Token`

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
