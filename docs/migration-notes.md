# Notas De Migracion

## Objetivo

Este documento preserva el contexto historico de la migracion inicial hacia la monorepo Git-managed.

No define el flujo operativo actual. Su proposito es dejar registro de como se arranco la repo y que material fue incorporado en la primera etapa.

## Setup Esperado En GitHub

Configuracion objetivo definida al iniciar la migracion:

- cuenta owner: la cuenta GitHub de la empresa
- repo: `redunisol-kestra`
- environments:
  - `kestra-dev`
  - `kestra-prod`
- secrets por environment:
  - `KESTRA_URL`
  - `KESTRA_USERNAME`
  - `KESTRA_PASSWORD`
  - `KESTRA_TENANT`

## Estado Inicial De Migracion

Contenido copiado originalmente desde el workspace operativo:

- `kestra/platform/infra/`
  - `docker-compose.yml`
  - `application.yaml`
  - `.env.example`
  - `apache/**`
  - `README.md`
- `kestra/automations/bitrix24/`
  - `flows/bitrix24_form_webhook.yaml`
  - `files/bitrix24_form_flow/**`
  - `docs/FORM_WEBHOOK_API.md`
- `kestra/platform/system/flows/redunisol/`
  - sin flows versionados por ahora

## Notas Historicas

- la migracion se hizo por copia, no por movimiento
- el material original siguio existiendo fuera de la monorepo
- los flows de prueba copiados inicialmente fueron eliminados de la monorepo
- no se copiaron `.env` ni `credentials.txt` para evitar versionar secretos

## Valor Actual Del Documento

Este documento sirve como referencia historica para entender:

- que material entro primero a la repo
- que supuestos existian al arranque de GitHub Actions
- que decisiones operativas no forman parte del flujo actual, pero explican el estado heredado