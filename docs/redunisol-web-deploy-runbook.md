# Redunisol Web Deploy Runbook

Este documento deja registrado el estado operativo validado para `web/redunisol-web/` y el criterio de trabajo entre desarrollo e integracion.

## Alcance

`web/redunisol-web/` se incorporo primero como boilerplate para validar la pipeline, la topologia de runtime y el circuito GitHub Actions -> VPS.

Al 2026-03-27, el deploy `dev` quedo validado end to end.

Al 2026-04-14 tambien quedo validado el bridge de formularios Laravel -> Kestra y se cerro un incidente real de propagacion de variables runtime dentro de `php-fpm`.

## Estado Verificado Al 2026-03-27

Quedo verificado lo siguiente:

- branch original revisada: `chore/SM/setup-env`
- conclusion funcional: era una base de aplicacion, no una homepage terminada
- merge a `main`: realizado
- workflow `deploy-redunisol-web-dev.yml`: funcionando en `main`
- dev deploy por GitHub Actions: exitoso
- host dev publico: `dev.redunisol.com.ar`
- DNS dev resuelve a `66.97.34.158`
- respuesta HTTP validada: `200 OK`
- runtime dev validado en VPS con `nginx`, `php-fpm`, `postgres` y `redis`

Run de referencia validado:

- GitHub Actions run `23647542487`
- commit: `3107ef4`

## Actualizacion Verificada Al 2026-04-14

- el endpoint interno `POST /api/form-submissions` quedo conectado con la accion backend que reenvia leads a Kestra
- las variables `KESTRA_FORM_WEBHOOK_URL`, `KESTRA_FORM_WEBHOOK_TIMEOUT_SECONDS` y `KESTRA_FORM_DEFAULT_LEAD_SOURCE` quedaron incorporadas al runtime efectivo de `php-fpm`
- el fix requirio tocar `web/redunisol-web/deploy/docker-compose.vps.yml` ademas del `.env` remoto
- el frontend sumo tracking con Google Tag Manager y flags de debug; eso agrega variables runtime `GTM_*` y variables de build `VITE_*`

## Modelo Operativo

`redunisol-web` sigue escenario B.

Eso implica:

- Git define codigo, imagenes, compose, workflows y configuracion declarativa
- PostgreSQL, Redis, storage y contenido administrado desde el panel son estado runtime
- `dev` se despliega automaticamente desde `main`
- `prod` se despliega manualmente

## Que `.env` Usa Cada Contexto

Hay tres niveles distintos y no conviene mezclarlos.

### Desarrollo local de la app

Laravel usa el `.env` local de la app:

- `web/redunisol-web/.env`

Ese archivo sale de:

- `web/redunisol-web/.env.example`

Ese `.env` local no es el que usa la VPS para deploy.

### Runtime env versionado para deploy

Los archivos operativos de deploy son estos:

- `web/redunisol-web/deploy/redunisol-web.dev.env.enc`
- `web/redunisol-web/deploy/redunisol-web.prod.env.enc`

Los plaintext locales de trabajo son estos:

- `web/redunisol-web/deploy/redunisol-web.dev.env`
- `web/redunisol-web/deploy/redunisol-web.prod.env`

Los `.env` plaintext locales se pueden editar para preparar cambios, pero no deben versionarse.

### `.env` efectivo que consume Docker Compose en la VPS

Durante el workflow:

1. GitHub Actions descifra `*.env.enc`
2. agrega `APP_IMAGE` y `WEB_IMAGE`
3. sube el archivo resultante como `.env` al directorio target remoto
4. ejecuta `docker compose --env-file .env ...`

El `.env` efectivo en la VPS queda dentro de:

- `/opt/redunisol-web-dev/.env`
- `/opt/redunisol-web-prod/.env`

Importante:

- el `.env` remoto no se consume como archivo `/var/www/.env` dentro de `php-fpm`
- `php-fpm` recibe una whitelist explicita via `environment:` en `web/redunisol-web/deploy/docker-compose.vps.yml`
- por eso, agregar una clave nueva a `deploy/*.env.enc` no alcanza si Laravel/PHP la necesita en runtime
- hoy esto aplica al bridge de formularios (`KESTRA_FORM_*`) y al bloque GTM renderizado desde Blade (`GTM_*`)
- las flags `VITE_TRACKING_DEBUG` y `VITE_GA4_DEBUG` pertenecen al build frontend, no al runtime de `php-fpm`

## Archivos Clave Del Deploy

Los archivos principales del circuito son estos:

- `.github/workflows/deploy-redunisol-web-dev.yml`
- `.github/workflows/deploy-redunisol-web-prod.yml`
- `web/redunisol-web/deploy/docker-compose.vps.yml`
- `web/redunisol-web/deploy/redunisol-web.dev.env.enc`
- `web/redunisol-web/deploy/redunisol-web.prod.env.enc`
- `web/redunisol-web/docker/common/php-fpm/Dockerfile`
- `web/redunisol-web/docker/production/nginx/Dockerfile`

## Flujo De Deploy Validado

El flujo real que quedo funcionando para `dev` es este:

1. merge a `main`
2. GitHub Actions construye y publica dos imagenes en GHCR
3. el workflow descifra `redunisol-web.dev.env.enc`
4. el workflow agrega `APP_IMAGE` y `WEB_IMAGE`
5. sube `.env` y `docker-compose.yml` a la VPS
6. actualiza `/opt/redunisol-web-dev`
7. ejecuta `docker compose config`, `pull` y `up -d`
8. valida que exista `public/build/manifest.json` dentro de `php-fpm`
9. valida HTTP usando el `Host` del ambiente y el bind interno

## Problemas Reales Que Hubo Y Ya Quedaron Resueltos

Durante la puesta en marcha aparecieron estos problemas:

- faltaba `gd` en la imagen PHP
- el build de assets para `nginx` necesitaba contexto PHP por Wayfinder
- habia problemas de line endings en scripts
- hubo que ajustar el path de datos de PostgreSQL 18
- una configuracion agregada de `php-fpm` era invalida
- `php-fpm` no tenia `public/build/manifest.json`
- el workflow fallaba si el `.env` descifrado venia con CRLF
- el workflow fallaba si el `.env` no terminaba con salto de linea antes de agregar `APP_IMAGE` y `WEB_IMAGE`
- el bridge de formularios devolvio `503` porque el `.env` remoto tenia `KESTRA_FORM_*` pero `docker-compose.vps.yml` no las exportaba al contenedor `php-fpm`

Por eso hoy los workflows ya incluyen:

- normalizacion de CRLF
- agregado seguro de newline al final del `.env`
- verificacion de manifest en `php-fpm`
- verificacion HTTP post deploy

## Responsabilidades

Separacion actual de responsabilidades:

- desarrollo: cambios de aplicacion y cambios declarativos dentro de la repo
- integracion: secrets, GitHub Actions, sincronizacion a VPS y validacion operativa

Traducido a trabajo diario:

- el dev trabaja en branch y abre pull requests
- el dev no necesita tocar la VPS ni ejecutar deploy manual en servidor
- el dev no deberia hacer cambios manuales persistentes fuera de Git
- integracion resuelve el deploy efectivo y las configuraciones operativas fuera de la repo

## Que Puede Cambiar El Dev Sin Coordinacion Operativa

En general, si el cambio vive entero en Git y la infraestructura actual ya sabe construirlo, entra por PR normal.

Ejemplos:

- `web/redunisol-web/app/**`
- `web/redunisol-web/config/**`
- `web/redunisol-web/resources/**`
- `web/redunisol-web/routes/**`
- `web/redunisol-web/tests/**`
- `web/redunisol-web/database/**`
- `web/redunisol-web/composer.json`
- `web/redunisol-web/package.json`

Excepcion importante:

- si el cambio en `app/**`, `config/**`, `routes/**`, `resources/**` o `resources/views/**` agrega consumo de nuevas variables runtime, webhooks externos, tags o tracking, deja de ser un cambio puramente de codigo y debe marcarse para coordinacion operativa

## Que Debe Marcar En El PR Porque Puede Requerir Intervencion

Estos cambios no deberian entrar silenciosamente:

- nuevos secretos o cambios en valores reales de entorno
- cambios en `deploy/*.env.enc`
- cambios en `.github/workflows/deploy-redunisol-web-*.yml`
- cambios en `deploy/docker-compose.vps.yml`
- cambios en `config/**` o `resources/views/**` que agreguen nuevas variables runtime
- cambios que sumen o cambien integraciones externas de formularios, webhooks o tracking
- cambios en `docker/` que agreguen dependencias de sistema o servicios nuevos
- migraciones delicadas o cambios que impliquen operacion sobre datos existentes
- necesidades de Apache, DNS, SSL, puertos o cambios del host

## Lo Que No Se Debe Hacer Como Flujo Normal

- no editar codigo directo en la VPS
- no corregir runtime manualmente y dejar Git desalineado
- no versionar `.env` plaintext
- no meter secretos en PRs
- no tomar el panel admin como lugar para configurar infraestructura

## Referencias

- `docs/redunisol-web-operating-model.md`
- `docs/ci-cd.md`
- `web/redunisol-web/README.md`