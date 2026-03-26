# AGENTS.md

## Purpose

Esta monorepo es la fuente de verdad Git para automatizaciones de Kestra y deja preparada la capa web futura.

- repo Git real actual: `redunisol-platform/`
- branch principal: `main`
- objetivo: versionar automatizaciones en Git y usar Kestra solo como runtime

El workspace raiz `kestra-deploy/` no es un repo Git. Ahi siguen existiendo artefactos operativos e historicos fuera de esta monorepo.

## Repo Map

### `kestra/automations/`

Contiene automatizaciones de negocio agrupadas por dominio.

Cada dominio puede incluir:

- `flows/`: flows YAML de Kestra
- `files/`: namespace files, codigo Python y scripts auxiliares
- `docs/`: documentacion propia del dominio
- `tests/`: tests del dominio

Dominios presentes hoy:

- `marketing-crm`
- `analisis-credito`
- `ahorros-amt`
- `cobranzas`
- `contabilidad`

### `kestra/platform/`

Contiene infraestructura y artefactos compartidos de plataforma.

- `kestra/platform/infra/`: Docker Compose, `application.yaml`, Apache y material operativo
- `kestra/platform/system/flows/`: flows del namespace system

### `kestra/tools/`

Scripts operativos de validacion y deploy.

- `deploy_kestra.py`: publica flows y namespace files en Kestra
- `validate_kestra.py`: valida estructura basica del repo

### `.github/workflows/`

Pipelines de GitHub Actions.

- `validate.yml`: validacion en pull requests
- `deploy-dev.yml`: deploy automatico o manual a dev
- `deploy-prod.yml`: deploy manual a prod

### `web/`

Espacio reservado para sitios web y componentes compartidos de frontend.

- `web/redunisol-web/`: sitio principal reservado
- `web/shared/`: espacio compartido reservado

### `docs/`

Documentacion tecnica transversal de la repo.

Documentos iniciales:

- `docs/architecture.md`
- `docs/ci-cd.md`
- `docs/kestra-configuration.md`

## Architecture Summary

Conviven dos capas:

1. Capa operativa historica/manual fuera de esta monorepo
2. Capa Git-managed dentro de esta monorepo

Kestra sigue siendo una instancia compartida. GitHub gestiona cambios y workflows. El runtime no debe considerarse fuente de verdad.

## Domain Model

En esta repo, `dominio` es una convencion Git. No es un objeto nativo de Kestra.

Un dominio agrupa:

- flows
- namespace files
- docs
- tests
- ownership por path en GitHub
- unidad de deploy

## Namespace Model

El deploy define el namespace final segun ambiente y dominio.

Patron actual:

- `redunisol.dev.<dominio>`
- `redunisol.prod.<dominio>`

Ejemplos conocidos:

- `redunisol.dev.marketing-crm`
- `redunisol.prod.marketing-crm`

Importante:

- el namespace escrito en el YAML no debe tomarse como namespace final de runtime
- `kestra/tools/deploy_kestra.py` reescribe el namespace antes de publicar
- la configuracion actual de runtime entra por variables globales del contenedor Kestra; no queda aislada por namespace automaticamente

## Runtime State Verified

Estado verificado al 2026-03-23:

- Kestra accesible por `http://kestra.redunisol.com.ar`
- tenant activo: `main`
- auth actual: basic auth simple con un solo usuario global
- usuario observado: `admin@kestra.local`
- runtime compartido entre flujo manual/historico y capa Git-managed

### Manual / Historical Endpoint

- namespace: `redunisol`
- flow id: `bitrix24_form_webhook`

Webhook manual actual:

`http://kestra.redunisol.com.ar/api/v1/main/executions/webhook/redunisol/bitrix24_form_webhook/bd_webhook_key_20260319_redunisol`

### Git-Managed Dev Endpoint Historico

Verificado el 2026-03-23:

- namespace: `redunisol.dev.bitrix24`
- flow: `bitrix24_form_webhook`
- revision observada: `1`
- namespace files subidos correctamente bajo `bitrix24_form_flow/`
- webhook dev probado end-to-end con respuesta `200`

Nota:

- este checkpoint corresponde al esquema anterior de dominios, antes del rename a `marketing-crm`
- el redeploy al namespace nuevo debe verificarse por separado

Webhook dev correcto:

`http://kestra.redunisol.com.ar/api/v1/main/executions/webhook/redunisol.dev.bitrix24/bitrix24_form_webhook/bd_webhook_key_20260319_redunisol`

Respuesta observada:

- `ok: true`
- `action: qualified`
- `reason: qualified`
- `qualified: true`

## CI/CD State Verified

Verificado el 2026-03-23:

- environments de GitHub creados:
   - `kestra-dev`
   - `kestra-prod`
- secrets cargados en ambos environments:
   - `KESTRA_URL`
   - `KESTRA_USERNAME`
   - `KESTRA_PASSWORD`
   - `KESTRA_TENANT`
- `Validate`: OK
- `Deploy Dev` para `bitrix24`: OK y confirmado por API de Kestra antes del rename de dominio a `marketing-crm`

No hay evidencia verificada de deploy real a prod desde GitHub Actions al momento de este checkpoint.

## Change Workflow

Flujo esperado de trabajo:

1. crear rama desde `main`
2. hacer cambios en la carpeta correspondiente
3. abrir pull request
4. dejar correr `Validate`
5. mergear a `main`
6. dejar que `Deploy Dev` publique el dominio afectado o dispararlo manualmente si aplica
7. usar `Deploy Prod` solo con decision explicita

## Adding A New Domain

Si se agrega un dominio nuevo dentro de `kestra/automations/`, no alcanza con crear la carpeta.

Tambien hay que revisar:

- `kestra/tools/deploy_kestra.py`
- `.github/workflows/deploy-dev.yml`
- `.github/workflows/deploy-prod.yml`
- `.github/CODEOWNERS` si se quiere ownership por dominio
- documentacion del dominio en `kestra/automations/<dominio>/docs/`

## Source Of Truth Rules

- Git es la fuente de verdad
- no editar flows ni namespace files en la UI de Kestra como flujo normal
- no usar la UI de Kestra como mecanismo normal para alta o cambio persistente de variables de runtime
- no subir `.env`, `credentials.txt` ni secretos al repo
- no asumir RBAC fino en Kestra; hoy no existe
- el control de contribucion debe hacerse en GitHub

## Read First

Para entender rapido la repo:

- `README.md`
- `docs/architecture.md`
- `docs/ci-cd.md`
- `docs/kestra-configuration.md`
- `.github/workflows/validate.yml`
- `.github/workflows/deploy-dev.yml`
- `.github/workflows/deploy-prod.yml`
- `kestra/tools/deploy_kestra.py`
- `kestra/automations/marketing-crm/flows/bitrix24_form_webhook.yaml`

## Non-Goals For Now

- no cambiar hardening de la VPS automaticamente
- no tocar el endpoint manual historico sin decision explicita
- no asumir separacion real de permisos dentro de Kestra
- no asumir que prod ya esta completamente Git-managed

## Last Verified Checkpoint

Fecha: 2026-03-23

Checkpoint validado:

- `Validate`: OK
- `Deploy Dev` para `bitrix24`: OK antes del rename a `marketing-crm`
- namespace `redunisol.dev.bitrix24`: existe como checkpoint historico
- flow `bitrix24_form_webhook` en `redunisol.dev.bitrix24`: existe como checkpoint historico
- namespace files `bitrix24_form_flow/**`: existen en Kestra
- webhook dev probado con payload de prueba: OK
