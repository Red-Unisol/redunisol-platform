# Guia Para Agregar Automatizaciones A Kestra

Este es el documento principal para trabajar en esta monorepo.

Si queres sumar una automatizacion nueva, aca deberia estar el recorrido completo: como decidir el dominio, que archivos crear, donde va cada cosa, como agregar configuracion y como llega el cambio a dev y prod.

## Que Guarda Esta Repo

Esta monorepo guarda automatizaciones Git-managed para Kestra y deja preparado espacio para futuros sitios web.

La idea operativa es esta:

- Git es la fuente de verdad
- Kestra es el runtime
- los cambios entran por pull request
- dev se despliega automaticamente desde `main`
- prod se despliega manualmente
- no se crea un ambiente nuevo por proyecto

Nota importante para la capa web:

- `web/herramientas/` sigue un modelo Git-managed muy cercano a runtime sin estado propio relevante
- `web/redunisol-web/` usa un modelo distinto: Git define infraestructura y aplicacion, pero el panel admin y la base de datos guardan estado runtime mutable
- ver `docs/redunisol-web-operating-model.md` para ese criterio

Ambientes actuales:

- `dev`
- `prod`

## Estructura Base

Todo lo relacionado con Kestra vive dentro de `kestra/`.

```text
kestra/
  automations/
    <dominio>/
      flows/
      files/
      docs/
      tests/
  platform/
  tools/

web/
  redunisol-web/
  shared/

tools/
```

Que va en cada carpeta:

- `kestra/automations/<dominio>/flows/`: flows YAML de Kestra
- `kestra/automations/<dominio>/files/`: namespace files, codigo Python y archivos auxiliares
- `kestra/automations/<dominio>/docs/`: documentacion del dominio
- `kestra/automations/<dominio>/tests/`: tests del dominio

Ejemplo completo actual:

- `kestra/automations/marketing-crm/`

## Paso 0: Decidir Si Va En Un Dominio Existente O En Uno Nuevo

No siempre conviene crear un dominio nuevo.

Usa un dominio existente si:

- la automatizacion pertenece al mismo sistema o integracion
- comparte la mayoria de sus variables y secretos
- comparte codigo o namespace files
- la mantiene el mismo equipo
- queres desplegarla junto con automatizaciones ya existentes de ese grupo

Crea un dominio nuevo si:

- cambia claramente el contexto de negocio
- cambia el sistema externo principal
- necesita ownership separado
- queres tratarlo como unidad de deploy independiente
- mezclarlo con otro dominio haria mas dificil entenderlo o mantenerlo

Regla pragmatica:

- si tenes dudas, empeza dentro de un dominio existente
- crea un dominio nuevo solo si la separacion mejora operacion y mantenimiento

Dominios definidos hoy:

- `marketing-crm`
- `analisis-credito`
- `ahorros-amt`
- `cobranzas`
- `contabilidad`

## Paso 1: Crear La Estructura Del Dominio O Reusar Una Existente

Si la automatizacion va en un dominio existente, trabaja dentro de esa carpeta.

Si necesitas un dominio nuevo, crea esto:

```text
kestra/automations/
  crm/
    flows/
    files/
    docs/
    tests/
```

## Paso 2: Crear El Flow YAML

Cada automatizacion empieza con un flow dentro de `flows/`.

Ejemplo:

```text
kestra/automations/crm/flows/alta_cliente.yaml
```

Puntos importantes:

- el YAML define el flow de Kestra
- el namespace escrito en el YAML no es el namespace final de runtime
- `kestra/tools/deploy_kestra.py` reescribe el namespace segun ambiente y dominio

Patron final de namespaces:

- `redunisol.dev.<dominio>`
- `redunisol.prod.<dominio>`

## Paso 3: Agregar Namespace Files Si El Flow Necesita Codigo O Recursos

Si el flow necesita Python, templates o archivos auxiliares, esos archivos van en `files/`.

Ejemplo:

```text
kestra/automations/crm/files/crm_flow/main.py
```

En Kestra, esos archivos se publican como namespace files.

Ejemplo real en esta repo:

- flow: `kestra/automations/marketing-crm/flows/bitrix24_form_webhook.yaml`
- namespace files: `kestra/automations/marketing-crm/files/bitrix24_form_flow/**`
- entrypoint ejecutado: `kestra/automations/marketing-crm/files/bitrix24_form_flow/kestra_webhook_entrypoint.py`

Idea simple:

- el YAML define que hacer
- las namespace files son el codigo o los archivos que el flow usa al correr

## Paso 4: Documentar La Automatizacion

Cada dominio deberia tener documentacion minima en `docs/`.

Archivo sugerido:

```text
kestra/automations/crm/docs/README.md
```

Contenido minimo recomendado:

- que hace la automatizacion
- que recibe
- que devuelve
- que flows incluye
- que variables usa
- que secretos usa
- como probarla

## Paso 5: Agregar Tests Si Hay Logica Propia

Si hay logica Python o transformaciones relevantes, agregá tests.

Archivo sugerido:

```text
kestra/automations/crm/tests/test_main.py
```

Si el dominio tiene una estructura distinta de tests, mantenela consistente con ese dominio.

## Paso 6: Agregar Configuracion Si El Flow La Necesita

No hardcodees configuracion ni secretos en el YAML o en Python.

Usa:

- `envs` para configuracion no sensible
- `secret(...)` para datos sensibles

Ejemplo:

```yaml
env:
  CRM_API_BASE_URL: "{{ envs.crm_api_base_url }}"
  CRM_TIMEOUT_SECONDS: "{{ envs.crm_timeout_seconds }}"
  CRM_API_TOKEN: "{{ secret('CRM_API_TOKEN') }}"
```

Regla simple:

- URLs, IDs, estados, timeouts: `envs`
- tokens, passwords, webhook keys: `secret(...)`

### Si Necesitas Variables O Secrets Nuevos

El camino correcto hoy es este:

1. cambiar el flow en Git
2. declarar la clave en `kestra/platform/infra/.env.example`
3. pasar la clave al servicio `kestra` en `kestra/platform/infra/docker-compose.yml`
4. cargar el valor real en el runtime env de infraestructura
5. desplegar infraestructura
6. probar en dev

Sobre el runtime env:

- el archivo versionado es `kestra/platform/infra/kestra-runtime.env.enc`
- el archivo local editable es `kestra/platform/infra/kestra-runtime.env`
- la key local es `kestra/platform/infra/kestra-runtime.local.key`
- la misma key se reutiliza para `web/herramientas/deploy/*.env.enc`

Si vas a tocar configuracion runtime, mira tambien:

- `docs/kestra-configuration.md`

## Paso 7: Si Es Un Dominio Nuevo, Sumalo Al Deploy

Esto es importante: crear la carpeta no alcanza.

Si agregas un dominio nuevo, hay que enseñarle al pipeline que existe.

Hoy el deploy conoce:

- `marketing-crm`
- `analisis-credito`
- `ahorros-amt`
- `cobranzas`
- `contabilidad`

Si agregas `crm`, revisar:

- `kestra/tools/deploy_kestra.py`
- `.github/workflows/deploy-dev.yml`
- `.github/workflows/deploy-prod.yml`
- `.github/CODEOWNERS` si queres ownership por dominio

Si no haces esto, el dominio puede existir en Git pero no quedar desplegable por pipeline.

## Paso 8: Crear Rama Y Abrir Pull Request

Trabaja siempre en una rama.

Ejemplos:

- `feat/crm-alta-cliente`
- `fix/cobranzas-timeout`

Despues:

```bash
git push -u origin <tu-rama>
```

En el PR explicá al menos:

- que cambia
- como probarlo
- si agrega variables nuevas
- si agrega secretos nuevos
- si requiere cambios de infraestructura
- si agrega un dominio nuevo

No mergear directo a `main`.

## Paso 9: Que Valida El Pipeline Antes Del Merge

El workflow `Validate` corre en pull request.

Hoy hace esto:

- validacion basica de estructura
- tests unitarios de Marketing CRM
- dry-run de deploy para Marketing CRM

Importante:

- `Validate` no publica cambios en Kestra
- si agregas tests para otros dominios, puede hacer falta extender `validate.yml`

## Paso 10: Que Pasa Cuando Mergeas A Main

Hay tres workflows distintos y no hacen lo mismo.

### Deploy Dev

Archivo:

- `.github/workflows/deploy-dev.yml`

Cuando corre:

- automaticamente en push a `main`
- manualmente si alguien lo dispara

Que hace:

- detecta que dominio cambio
- publica flows y namespace files de ese dominio en dev

### Deploy Prod

Archivo:

- `.github/workflows/deploy-prod.yml`

Cuando corre:

- solo manualmente

Que hace:

- toma `main`
- publica el dominio elegido al namespace de prod

### Deploy Infra

Archivo:

- `.github/workflows/deploy-infra.yml`

Cuando corre:

- automaticamente en push a `main` si cambian archivos de `kestra/platform/infra/`
- manualmente si alguien lo dispara

Que hace:

- sincroniza `docker-compose.yml`, `application.yaml` y el runtime env cifrado hacia `/opt/kestra`
- corre `docker compose pull` y `docker compose up -d`

Importante:

- deploy de flows y deploy de infraestructura son procesos distintos

## Paso 11: Como Probar En Dev

Despues del merge a `main`, verificar:

- que `Deploy Dev` haya corrido
- que el flow exista en `redunisol.dev.<dominio>`
- que las namespace files necesarias se hayan subido
- que la configuracion runtime exista si el flow la necesita
- que el endpoint o ejecucion real responda como se espera

## Paso 12: Como Llegar A Prod

Prod no se publica solo.

El flujo actual es:

1. validar bien en dev
2. entrar a GitHub Actions
3. correr `Deploy Prod`
4. elegir el dominio
5. publicar desde `main`

## Checklist Rapido

Antes de abrir el PR, confirmar:

- la automatizacion esta en el dominio correcto
- el flow YAML esta en `flows/`
- el codigo y archivos auxiliares estan en `files/`
- la documentacion minima esta en `docs/`
- los tests estan agregados si hacen falta
- no hay valores hardcodeados sensibles
- si hay variables nuevas, estan reflejadas en infraestructura
- si hay dominio nuevo, el deploy fue actualizado

## Si Querés Entender Mejor La Repo

Documentos complementarios:

- `docs/README.md`
- `docs/architecture.md`
- `docs/ci-cd.md`
- `docs/kestra-configuration.md`
- `AGENTS.md`

Ejemplo de referencia para copiar estructura:

- `kestra/automations/marketing-crm/`