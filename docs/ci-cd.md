# CI/CD Y Deploy

## Objetivo

Este documento describe como se validan y despliegan cambios desde GitHub hacia Kestra.

## Componentes

La cadena actual tiene cinco piezas principales:

1. pull request
2. GitHub Actions
3. scripts de `kestra/tools/`
4. SSH hacia la VPS
5. API de Kestra

## Workflows Actuales

### `validate.yml`

Corre en pull requests y tambien manualmente.

Hoy hace esto:

- checkout del repo
- setup de Python 3.11
- instalacion de dependencias desde `kestra/tools/requirements.txt`
- validacion basica de estructura con `kestra/tools/validate_kestra.py`
- tests unitarios de Marketing CRM
- dry-run de deploy para Marketing CRM

Importante:

- `Validate` no publica cambios en Kestra
- sirve para frenar errores antes del merge

### `deploy-dev.yml`

Corre en push a `main` y tambien manualmente.

Comportamiento:

- detecta cambios por dominio con filtros de paths
- despliega a `kestra-dev` solo los dominios afectados
- tambien puede ejecutarse manualmente para un dominio o para todos

Hoy contempla:

- `marketing-crm`
- `analisis-credito`
- `ahorros-amt`
- `cobranzas`
- `contabilidad`

### `deploy-prod.yml`

Corre solo manualmente.

Comportamiento:

- hace checkout de `main`
- instala dependencias
- despliega el dominio elegido al environment `kestra-prod`

### `deploy-infra.yml`

Corre en push a `main` cuando cambian archivos operativos del stack y tambien manualmente.

Alcance de esta primera version:

- `kestra/platform/infra/docker-compose.yml`
- `kestra/platform/infra/application.yaml`
- `kestra/platform/infra/kestra-runtime.env.enc`

Comportamiento:

- hace checkout de `main`
- instala dependencias de `kestra/tools/`
- descifra `kestra/platform/infra/kestra-runtime.env.enc` usando un secret de GitHub
- sube `docker-compose.yml`, `application.yaml` y `.env` a `/opt/kestra` por SSH
- valida `docker compose config`
- ejecuta `docker compose pull` y `docker compose up -d`

Importante:

- este workflow no publica flows ni namespace files
- este workflow no toca Apache en esta version
- este workflow aplica infraestructura compartida de la instancia

## Script De Deploy

`kestra/tools/deploy_kestra.py` es la pieza central del deploy.

Responsabilidades:

- resolver dominios objetivo
- construir namespace final por ambiente
- reescribir el namespace dentro del YAML antes de publicar
- subir flows por API
- subir namespace files por API

Patron actual de namespace:

- `redunisol.dev.<dominio>`
- `redunisol.prod.<dominio>`

## Variables Esperadas En CI

Los workflows de deploy usan estos secrets de GitHub:

- `KESTRA_URL`
- `KESTRA_USERNAME`
- `KESTRA_PASSWORD`
- `KESTRA_TENANT`

El workflow de infraestructura compartida usa ademas:

- `RUNTIME_ENV_KEY`
- `VPS_SSH_HOST`
- `VPS_SSH_PORT`
- `VPS_SSH_USER`
- `VPS_SSH_PRIVATE_KEY`

Environments esperados:

- `kestra-dev`
- `kestra-prod`
- `vps-infra`

## Que Pasa Cuando Se Hace Merge A Main

Flujo esperado:

1. el PR pasa `Validate`
2. se mergea a `main`
3. si cambiaron flows o namespace files, `deploy-dev.yml` detecta dominios cambiados
4. si cambio infraestructura operativa, `deploy-infra.yml` sincroniza `/opt/kestra`
5. el job correspondiente publica flows y namespace files en Kestra dev

## Que Pasa En Prod

Prod no se despliega automaticamente.

El flujo actual es:

1. elegir dominio manualmente
2. correr `Deploy Prod`
3. tomar el estado actual de `main`
4. publicar al namespace prod correspondiente

## Limites Actuales Del Pipeline

Hoy el pipeline no resuelve automaticamente estos problemas:

- agregar un dominio nuevo sin tocar workflows y script de deploy
- validar tests de nuevos dominios si `validate.yml` no fue extendido
- borrar artefactos viejos automaticamente en Kestra
- resolver promotion rules complejas entre manual/historico y Git-managed
- desplegar configuracion de Apache del host

## Agregar Un Dominio Nuevo

Si se agrega `kestra/automations/<dominio>/`, revisar:

- `kestra/tools/deploy_kestra.py`
- `.github/workflows/deploy-dev.yml`
- `.github/workflows/deploy-prod.yml`
- `.github/CODEOWNERS` si aplica
- tests y docs del dominio

Si no se hace eso, el dominio puede quedar versionado pero no desplegable por pipeline.

## Riesgos Operativos A Tener En Cuenta

- el runtime Kestra sigue compartido con flujos historicos
- no hay RBAC fino por namespace
- prod no esta verificado como totalmente Git-managed
- el namespace manual `redunisol` no debe modificarse sin decision explicita

## Estado Verificado Al 2026-03-23

- `Validate`: OK
- `Deploy Dev` para `bitrix24`: OK como checkpoint historico previo al rename a `marketing-crm`
- namespace `redunisol.dev.bitrix24`: verificado como checkpoint historico
- deploy prod desde GitHub Actions: no verificado en runtime