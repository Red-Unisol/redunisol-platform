# CI/CD Y Deploy

## Objetivo

Este documento describe como se validan y despliegan cambios desde GitHub hacia Kestra.

## Componentes

La cadena actual tiene seis piezas principales:

1. pull request
2. GitHub Actions
3. scripts de `kestra/tools/`
4. SSH hacia la VPS
5. API de Kestra
6. Docker Compose de runtime para la capa web

Los servicios compartidos de `platform/` usan el mismo modelo de runtime env
cifrado y deploy por SSH.

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
- el archivo `.env.enc` ya no se guarda como un blob unico: ahora preserva nombres de variables y comments, con valores cifrados por linea para reducir conflictos de merge
- por `push` sigue corriendo solo desde `main`
- manualmente puede correrse desde `main` o `dev`, pero sigue aplicando sobre la misma instancia compartida en `/opt/kestra`

### `deploy-metamap-server-dev.yml`

Construye y despliega `apps/metamap-platform/server/` en
`/opt/metamap-platform-server-dev`.

Comportamiento:

- corre automaticamente en push a `main` o `dev` cuando cambia el servidor o el workflow
- tambien admite ejecucion manual mediante `workflow_dispatch`
- publica la imagen con tags `dev-<git-sha>` y `dev-latest` en GHCR
- descifra el runtime env versionado y actualiza Docker Compose por SSH
- valida primero `/health` dentro de la VPS y despues el healthcheck publico
  `https://kestra.redunisol.com.ar/metamap-platform/health`

Para cambios coordinados con `transferencias-celesol`, desplegar primero el servidor y
distribuir despues el ZIP desktop. El cliente conserva eventos en su outbox si el endpoint
de trazabilidad todavia no esta disponible, pero ese estado no debe mantenerse como forma
normal de operacion.

El merge a `main` despliega automaticamente el runtime operativo actual. No existe un
workflow separado de deploy a prod.

Checkpoint historico del 2026-09-03: el run manual `33771696321` desplego desde `main` el
server `0.7.0`, commit `1e47df0`, y se verificaron el healthcheck publico y la proteccion
autenticada del endpoint de trazabilidad. Para conocer el estado actual, volver a consultar
el runtime.

### `deploy-zipline-dev.yml`

Despliega `platform/zipline/` en `/opt/zipline-dev`.

Comportamiento:

- corre en push a `dev` cuando cambia Zipline y tambien manualmente desde `dev`
- descifra `platform/zipline/zipline.dev.env.enc`
- levanta Zipline v4 y PostgreSQL con Docker Compose
- preserva base de datos, uploads, public assets y themes en `/opt/zipline-dev/data`
- valida el healthcheck interno en `127.0.0.1:3040`
- deja el vhost versionado en `/opt/zipline-dev/apache/` para activarlo en el Apache frontal

La publicacion prevista es `https://media-dev.redunisol.com.ar`. DNS,
certificado Let's Encrypt y activacion del vhost son prerequisitos externos al
contenedor.

### `deploy-zipline-prod.yml`

Despliega `platform/zipline/` en `/opt/zipline-prod`.

Comportamiento:

- corre solo manualmente desde `main`
- descifra `platform/zipline/zipline.prod.env.enc`
- levanta Zipline v4 y PostgreSQL con Docker Compose
- preserva base de datos, uploads, public assets y themes en `/opt/zipline-prod/data`
- valida el healthcheck interno en `127.0.0.1:3041`
- deja el vhost versionado en `/opt/zipline-prod/apache/` para activarlo en el Apache frontal

La publicacion prevista es `https://media.redunisol.com.ar`. DNS, certificado
Let's Encrypt y activacion del vhost son prerequisitos externos al contenedor.

### `publish-analisis-credito-consulta-cuad-image.yml`

Publica la imagen Docker usada por `consulta_cuad`.

Comportamiento:

- construye una imagen basada en Playwright
- publica tags `sha-<commit>` y `latest` en GHCR
- corre cuando cambia el Dockerfile de `consulta-cuad`, el flow asociado o el propio workflow

### `deploy-herramientas-dev.yml` y `deploy-herramientas-prod.yml`

Despliegan `web/herramientas/` como aplicacion stateless y Git-managed.

Comportamiento:

- construyen una sola imagen Docker
- descifran el runtime env correspondiente desde Git
- suben `docker-compose.vps.yml` y `.env` a la VPS
- actualizan la app remota via `docker compose pull` y `up -d`

### `deploy-redunisol-web-dev.yml` y `deploy-redunisol-web-prod.yml`

Despliegan `web/redunisol-web/` bajo escenario B.

Comportamiento:

- construyen dos imagenes Docker: `php-fpm` y `nginx`
- descifran el runtime env correspondiente desde Git
- suben `docker-compose.vps.yml` y `.env` a la VPS
- levantan una topologia con `nginx`, `php-fpm`, `postgres` y `redis`
- preservan estado runtime en volumenes persistentes de base de datos, redis y storage
- exponen al contenedor `php-fpm` una whitelist explicita de variables runtime desde `deploy/docker-compose.vps.yml`
- validan en la VPS que `php-fpm` tenga `public/build/manifest.json`
- validan la aplicacion por HTTP usando el `Host` y el bind interno definidos en el runtime env

Importante:

- Git define codigo, imagenes, compose y configuracion declarativa
- PostgreSQL, Redis y storage mantienen el estado mutable del producto
- este flujo sigue el modelo operativo documentado en `docs/redunisol-web-operating-model.md`
- el runbook operativo y la separacion entre desarrollo e integracion quedaron documentados en `docs/redunisol-web-deploy-runbook.md`
- si una clave nueva la consume Laravel/PHP en runtime, no alcanza con agregarla al `.env.enc`; tambien hay que mapearla en `environment:` de `php-fpm`

### `deploy-mutual-celesol-prod.yml`

Despliega `web/mutual-celesol/` como sitio publico prod-only para `mutualcelesol.com`.

Comportamiento:

- corre manualmente desde `main` o via `workflow_call`
- construye una imagen Docker Apache/PHP
- valida que el artefacto no incluya zips, metadata de macOS ni el viejo `grav-admin`
- valida sintaxis PHP de los endpoints dinamicos incluidos en el export
- genera un `.env` no sensible en el workflow
- sube `docker-compose.vps.yml` y `.env` a la VPS
- actualiza el contenedor remoto via `docker compose pull` y `up -d`
- valida `/health.php`, `/celesol-web/` y el redirect `/` -> `/celesol-web/` contra el bind interno

## Redunisol Web: Flujo Runtime Y `.env`

`web/redunisol-web/` usa tres niveles distintos de configuracion:

- `.env` local de Laravel para desarrollo dentro de `web/redunisol-web/`
- runtime env cifrado versionado en `web/redunisol-web/deploy/*.env.enc`
- `.env` efectivo remoto generado por el workflow dentro del target dir de la VPS

Para deploy:

1. el workflow descifra `redunisol-web.dev.env.enc` o `redunisol-web.prod.env.enc`
2. normaliza line endings
3. asegura newline final
4. agrega `APP_IMAGE` y `WEB_IMAGE`
5. sube el archivo final como `.env` al target remoto
6. ejecuta `docker compose --env-file .env ...`
7. repullea solo `php-fpm` y `web`; `postgres` y `redis` son servicios stateful de runtime y no se repullean en cada deploy

Importante en la topologia actual:

- el `.env` remoto no se monta como `/var/www/.env` dentro de `php-fpm`
- `php-fpm` recibe una lista explicita de variables desde `web/redunisol-web/deploy/docker-compose.vps.yml`
- si Laravel/PHP necesita una clave nueva en runtime, hay que tocar tanto `deploy/*.env.enc` como `deploy/docker-compose.vps.yml`
- hoy ese contrato incluye el bridge de formularios (`KESTRA_FORM_*`) y el bloque GTM renderizado desde Blade (`GTM_*`)
- las flags `VITE_TRACKING_DEBUG` y `VITE_GA4_DEBUG` pertenecen al build frontend y deben existir en el contexto donde se compilan assets

Este detalle importa porque ya hubo dos fallas reales resueltas en GitHub Actions:

- CRLF en el `.env` descifrado
- falta de salto de linea final antes de agregar `APP_IMAGE` y `WEB_IMAGE`
- `php-fpm` sin acceso a `KESTRA_FORM_*` aunque el `.env` remoto ya tenia las claves, porque el compose no las exportaba al contenedor

Estado verificado al 2026-03-27 para `redunisol-web`:

- mergeado a `main`
- workflow dev funcionando end to end
- validacion HTTP `200 OK` en `dev.redunisol.com.ar`
- runtime dev operativo en VPS

Actualizacion verificada al 2026-04-14 para `redunisol-web`:

- el endpoint `POST /api/form-submissions` quedo operativo para reenviar leads a Kestra desde Laravel
- `KESTRA_FORM_WEBHOOK_URL`, `KESTRA_FORM_WEBHOOK_TIMEOUT_SECONDS` y `KESTRA_FORM_DEFAULT_LEAD_SOURCE` quedaron mapeadas al `php-fpm` remoto
- el frontend sumo tracking con GTM y flags de debug; `GTM_*` afecta runtime web y `VITE_*` afecta build frontend

## Script De Deploy

`kestra/tools/deploy_kestra.py` es la pieza central del deploy.

Responsabilidades:

- resolver dominios objetivo
- construir namespace final por ambiente
- reescribir el namespace dentro del YAML antes de publicar
- quitar `triggers` en ambientes no prod para flows marcados con `labels.schedule_scope = prod_only`
- consultar si el flow ya existe antes de publicarlo
- actualizar flows existentes con `PUT` al recurso puntual o crearlos con `POST /flows` cuando faltan
- subir namespace files por API

Patron actual de namespace:

- `redunisol.dev.<dominio>`
- `redunisol.prod.<dominio>`

Regla actual para schedulers:

- un flow con `labels.schedule_scope: prod_only` mantiene sus `triggers` en `prod`
- ese mismo flow se publica sin `triggers` en `dev`
- esto permite probarlo manualmente en `dev` sin duplicar ejecuciones automaticas contra el mismo runtime compartido

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
- promover contenido mutable entre `dev` y `prod` en `web/redunisol-web/`
- rotar secretos o redefinir valores operativos reales sin intervencion manual

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
