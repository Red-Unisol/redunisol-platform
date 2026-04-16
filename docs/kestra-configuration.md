# Configuracion De Kestra

## Objetivo

Este documento centraliza la configuracion usada por la repo para:

- deploy desde GitHub Actions
- variables de runtime consumidas por flows
- secrets de runtime consumidos por flows
- criterio para agregar configuracion nueva

## Dos Capas Distintas De Configuracion

Es importante no mezclar estas dos capas:

### 1. Configuracion de CI/CD en GitHub

Se usa para que los workflows puedan autenticarse contra Kestra, descifrar configuracion runtime y ejecutar deploys.

Secrets actuales esperados en GitHub environments:

- `KESTRA_URL`
- `KESTRA_USERNAME`
- `KESTRA_PASSWORD`
- `KESTRA_TENANT`

Secrets adicionales para deploy de infraestructura:

- `RUNTIME_ENV_KEY`
- `VPS_SSH_HOST`
- `VPS_SSH_PORT`
- `VPS_SSH_USER`
- `VPS_SSH_PRIVATE_KEY`

Estos valores viven en GitHub, no en los flows ni en los runtime env cifrados.

Environment recomendado para esos secrets:

- `vps-infra`

El workflow `Validate MetaMap Server` tambien toma `RUNTIME_ENV_KEY`
desde ese mismo environment para validar los runtime env cifrados de
`apps/metamap-platform/server/deploy/`.

### 2. Configuracion de runtime dentro de Kestra

Se usa cuando un flow necesita datos de configuracion o secretos al ejecutarse.

En esta repo hoy se consumen de dos formas:

- `{{ envs.algo }}` para configuracion no sensible
- `{{ secret('ALGO') }}` para datos sensibles

## Implementacion Actual En Esta Repo

En la infraestructura actual, los flows no inventan su configuracion solos.

El flujo tecnico actual es este:

1. los valores reales viven en `/opt/kestra/.env` en la VPS
2. Docker Compose lee ese `.env`
3. `docker-compose.yml` inyecta esas claves al contenedor `kestra`
4. Kestra recibe esas variables como entorno del proceso
5. los flows las consumen con `envs.*` y `secret(...)`

En otras palabras:

- Kestra no lee directamente el archivo `.env`
- Docker Compose lee `.env` y pasa el resultado al contenedor
- para secrets, Kestra espera variables con prefijo `SECRET_` y valores codificados en Base64

La definicion versionada de ese mecanismo vive en:

- `kestra/platform/infra/.env.example`
- `kestra/platform/infra/docker-compose.yml`

Patron actual:

- variables no sensibles en Docker Compose con prefijo `ENV_`
- secretos en Docker Compose con prefijo `SECRET_`

Ejemplos reales:

- `ENV_VIMARX_TIMEOUT_SECONDS`
- `ENV_VIMARX_VERIFY_TLS`
- `ENV_BITRIX24_BASE_URL`
- `ENV_BITRIX24_LEAD_BCRA_STATUS_FIELD`
- `ENV_BITRIX24_LEAD_BCRA_RESULT_FIELD`
- `ENV_BITRIX24_LEAD_BCRA_CHECKED_AT_FIELD`
- `ENV_BITRIX24_TIMEOUT_SECONDS`
- `SECRET_BITRIX24_WEBHOOK_PATH`
- `SECRET_BITRIX24_FORM_WEBHOOK_KEY`
- `SECRET_ANALISIS_CREDITO_WEBHOOK_KEY`
- `SECRET_ANALISIS_CREDITO_INCOMING_METAMAP_WEBHOOK_KEY`
- `SECRET_DEVEXPRESS_EVALUATE_API_BASE_URL`

## Estado Verificado En VPS

Verificado el 2026-03-23 por SSH en `/opt/kestra`:

- existe archivo `.env` operativo
- existe `docker-compose.yml` operativo
- los nombres de variables Bitrix24 esperados por la repo estan cargados en el entorno operativo
- los nombres de variables Bitrix24 tambien aparecen en la configuracion efectiva de Docker Compose

Importante:

- se verifico presencia y nombres de claves
- no se exponen valores sensibles en este documento
- esta verificacion no implica que los valores sean correctos funcionalmente, solo que las claves existen en la VPS

## Camino Correcto Para Agregar O Modificar Variables

En esta instalacion, el camino correcto no es la UI de Kestra como flujo normal de trabajo.

El camino correcto hoy es:

1. cambiar el flow en Git si necesita una clave nueva
2. declarar la clave en `kestra/platform/infra/.env.example`
3. pasar la clave al servicio `kestra` en `kestra/platform/infra/docker-compose.yml`
4. cargar el valor real en `/opt/kestra/.env` en la VPS
5. reiniciar o recrear el servicio Kestra
6. probar en dev

La UI no deberia ser la fuente normal de configuracion persistente, porque rompe el modelo Git-managed de esta repo.

## Variables Nuevas Para Snapshot BCRA En Marketing CRM

La integracion de `marketing-crm` con Central de Deudores agrega tres variables no sensibles nuevas para persistir el snapshot en Bitrix24:

- `ENV_BITRIX24_LEAD_BCRA_STATUS_FIELD`
- `ENV_BITRIX24_LEAD_BCRA_RESULT_FIELD`
- `ENV_BITRIX24_LEAD_BCRA_CHECKED_AT_FIELD`

Uso previsto:

- `status`: texto corto para estados como `OK`, `SIN_DATOS`, `NEGATIVO` o `IDENTIFICACION_INVALIDA`
- `result`: payload JSON compacto con el resumen de la consulta
- `checked_at`: timestamp ISO UTC de la ultima consulta

Importante:

- los IDs reales de esos campos deben existir previamente en Bitrix24
- si esos campos no estan configurados, la clasificacion puede seguir consultando BCRA para decidir rechazo, pero no persistira snapshot
- el flow programado `bitrix24_bcra_backfill` se auto-omite hasta que esas tres variables esten configuradas

## Opcion Recomendada Para Evitar Doble Actualizacion

Si la prioridad es evitar drift entre repo y VPS, una opcion razonable es versionar la configuracion runtime en Git, pero cifrada.

La idea seria:

1. mantener `docker-compose.yml` y `application.yaml` versionados en Git
2. mantener archivos runtime cifrados en Git
3. descifrarlo localmente solo cuando haga falta editarlo
4. volver a cifrarlo antes del pull request
5. dejar que un deploy de infraestructura sincronice la version cifrada ya aprobada hacia la VPS

Ese deploy ya queda implementado en `.github/workflows/deploy-infra.yml`.

Alcance actual del workflow:

- descifra `kestra/platform/infra/kestra-runtime.env.enc` en el runner
- sube `.env`, `docker-compose.yml` y `application.yaml` a `/opt/kestra`
- corre `docker compose config`, `docker compose pull` y `docker compose up -d`
- limpia el plaintext descifrado al terminar

Fuera de alcance en esta version:

- configuracion de Apache del host
- cambios manuales fuera de `/opt/kestra`

Formato actual de los `.env.enc`:

- nombre de variable en plaintext
- valor cifrado por linea
- comentarios y lineas vacias preservados
- cifrado deterministico autenticado para que dos ramas que no cambian el valor de una variable no regeneren ciphertext distinto

Archivos concretos usados en esta repo:

- plaintext local no versionado: `kestra/platform/infra/kestra-runtime.env`
- key local compartida no versionada: `.local-secrets/runtime-env.key`
- archivo cifrado versionado: `kestra/platform/infra/kestra-runtime.env.enc`
- plaintext local no versionado: `web/herramientas/deploy/herramientas.dev.env`
- plaintext local no versionado: `web/herramientas/deploy/herramientas.prod.env`
- archivos cifrados versionados: `web/herramientas/deploy/herramientas.dev.env.enc` y `web/herramientas/deploy/herramientas.prod.env.enc`
- plaintext local no versionado: `apps/metamap-platform/server/deploy/metamap-platform-server.dev.env`
- plaintext local no versionado: `apps/metamap-platform/server/deploy/metamap-platform-server.prod.env`
- archivos cifrados versionados: `apps/metamap-platform/server/deploy/metamap-platform-server.dev.env.enc` y `apps/metamap-platform/server/deploy/metamap-platform-server.prod.env.enc`

## Tool Local Para Cifrar Y Descifrar

La repo incluye esta utilidad:

- `kestra/tools/manage_encrypted_env.py`

Subcomandos disponibles:

- `generate-key`: genera una key Fernet local
- `encrypt`: cifra un archivo plaintext linea por linea
- `decrypt`: descifra un archivo cifrado

Comportamiento actual del tooling:

- al descifrar en modo `human`, las claves `SECRET_*` se escriben en plaintext real para que se puedan revisar y editar como humano
- al descifrar en modo `runtime`, las claves `SECRET_*` se escriben en el formato esperado por Kestra runtime, o sea Base64-ready dentro del `.env`
- al cifrar, las claves `SECRET_*` se convierten automaticamente a Base64 antes de encriptarse
- el archivo descifrado agrega arriba el comentario `NO USAR BASE 64 PARA LOS SECRETOS EL TOOLING LO MANEJA POR SI MISMO`
- ese comentario es solo para el archivo plaintext local en modo `human`; el tooling lo remueve antes de generar el archivo cifrado
- el decrypt sigue soportando el formato legacy cifrado como blob completo, para migracion gradual

Flujo sugerido:

1. generar una key local no versionada
2. descifrar el archivo cifrado a `kestra/platform/infra/kestra-runtime.env`
3. editar el plaintext localmente
4. volver a cifrarlo
5. mantener el plaintext solo como archivo local ignorado por Git
6. hacer pull request solo con el archivo cifrado

Esos paths ya estan ignorados por Git cuando corresponde.

La key local se guarda en un path neutral del workspace porque hoy cifra varios runtime env del repo, no solo el de Kestra.

Ejemplos de uso:

```bash
python kestra/tools/manage_encrypted_env.py generate-key --output .local-secrets/runtime-env.key
python kestra/tools/manage_encrypted_env.py decrypt --key-file .local-secrets/runtime-env.key --input kestra/platform/infra/kestra-runtime.env.enc --output kestra/platform/infra/kestra-runtime.env --force
python kestra/tools/manage_encrypted_env.py decrypt --key-file .local-secrets/runtime-env.key --input kestra/platform/infra/kestra-runtime.env.enc --output kestra/platform/infra/kestra-runtime.runtime.env --output-format runtime --force
python kestra/tools/manage_encrypted_env.py encrypt --key-file .local-secrets/runtime-env.key --input kestra/platform/infra/kestra-runtime.env --output kestra/platform/infra/kestra-runtime.env.enc --force
```

Importante:

- la key local no debe versionarse
- el archivo plaintext descifrado no debe versionarse
- el archivo cifrado si puede versionarse
- si se pierde la key, el archivo cifrado no se puede recuperar
- los `SECRET_*` deben editarse en plaintext real, no en Base64
- las tasks locales de VS Code deben seguir usando el modo `human`
- los deploys automatizados de infraestructura deben usar el modo `runtime`

## Tasks De VS Code

La repo incluye tareas versionadas en `.vscode/tasks.json` para correr el flujo sin recordar comandos.

Tareas disponibles:

- `Runtime Env: Generate Shared Key`
- `Runtime Env: Decrypt All`
- `Runtime Env: Encrypt All`

Flujo recomendado con tasks:

1. correr `Kestra: Generate Runtime Key` una sola vez por maquina local
2. correr `Runtime Env: Decrypt All`
3. editar los plaintext que correspondan
4. correr `Runtime Env: Encrypt All`
5. hacer pull request con los archivos `.env.enc` versionados que hayan cambiado

## Como Se Mapea A Los Flows

### Variables no sensibles

Patron:

- infraestructura: `ENV_<NOMBRE_EN_MAYUSCULAS>`
- flow: `{{ envs.<nombre_en_minusculas> }}`

Ejemplo:

- infraestructura: `ENV_BITRIX24_BASE_URL`
- flow: `{{ envs.bitrix24_base_url }}`

### Secrets

Patron:

- infraestructura: `SECRET_<NOMBRE_EN_MAYUSCULAS>`
- flow: `{{ secret('<NOMBRE_EN_MAYUSCULAS>') }}`

Ejemplo:

- infraestructura: `SECRET_BITRIX24_WEBHOOK_PATH`
- flow: `{{ secret('BITRIX24_WEBHOOK_PATH') }}`

## Alcance Real De La Configuracion

En el modelo actual, estas claves quedan cargadas a nivel de instancia Kestra.

Eso significa:

- no quedan aisladas por dominio
- no quedan aisladas por namespace
- no quedan aisladas por flow

En la practica, si un flow corre en la misma instancia y conoce el nombre de una clave, puede intentar leerla.

Respuesta corta a la pregunta operativa:

- si, hoy las variables de runtime estan potencialmente disponibles para todos los namespaces de esa misma instancia

Los namespaces separan flows y artefactos publicados, pero no separan automaticamente estas variables globales del contenedor.

## Catalogo Actual Verificado

### GitHub Actions

Usados por deploy:

- `KESTRA_URL`
- `KESTRA_USERNAME`
- `KESTRA_PASSWORD`
- `KESTRA_TENANT`

### Runtime Bitrix24: variables no sensibles

Referenciadas hoy desde los flows:

- `kestra/automations/marketing-crm/flows/bitrix24_form_webhook.yaml`
- `kestra/automations/marketing-crm/flows/bitrix24_lead_classification.yaml`

- `bitrix24_base_url`
- `bitrix24_contact_cuil_field`
- `bitrix24_lead_processing_policy_field`
- `bitrix24_lead_processing_policy_skip`
- `bitrix24_lead_processing_policy_process`
- `bitrix24_lead_cuil_field`
- `bitrix24_lead_employment_status_field`
- `bitrix24_lead_payment_bank_field`
- `bitrix24_lead_province_field`
- `bitrix24_lead_source_field`
- `bitrix24_lead_rejection_reason_field`
- `bitrix24_lead_status_qualified`
- `bitrix24_lead_status_rejected`
- `bitrix24_timeout_seconds`

En la infraestructura actual corresponden a:

- `ENV_BITRIX24_BASE_URL`
- `ENV_BITRIX24_CONTACT_CUIL_FIELD`
- `ENV_BITRIX24_LEAD_PROCESSING_POLICY_FIELD`
- `ENV_BITRIX24_LEAD_PROCESSING_POLICY_SKIP`
- `ENV_BITRIX24_LEAD_PROCESSING_POLICY_PROCESS`
- `ENV_BITRIX24_LEAD_CUIL_FIELD`
- `ENV_BITRIX24_LEAD_EMPLOYMENT_STATUS_FIELD`
- `ENV_BITRIX24_LEAD_PAYMENT_BANK_FIELD`
- `ENV_BITRIX24_LEAD_PROVINCE_FIELD`
- `ENV_BITRIX24_LEAD_SOURCE_FIELD`
- `ENV_BITRIX24_LEAD_REJECTION_REASON_FIELD`
- `ENV_BITRIX24_LEAD_STATUS_QUALIFIED`
- `ENV_BITRIX24_LEAD_STATUS_REJECTED`
- `ENV_BITRIX24_TIMEOUT_SECONDS`

Presencia verificada en VPS:

- si

### Runtime Analisis Credito: variables no sensibles

Referenciadas hoy desde el flow `kestra/automations/analisis-credito/flows/renovacion_cruz_del_eje.yaml`:

- `vimarx_timeout_seconds`
- `vimarx_verify_tls`

En la infraestructura actual corresponden a:

- `ENV_VIMARX_TIMEOUT_SECONDS`
- `ENV_VIMARX_VERIFY_TLS`

Presencia requerida en VPS:

- si

### Runtime Bitrix24: secrets

Referenciados hoy desde el flow:

- `BITRIX24_WEBHOOK_PATH`
- `BITRIX24_FORM_WEBHOOK_KEY`

En la infraestructura actual corresponden a:

- `SECRET_BITRIX24_WEBHOOK_PATH`
- `SECRET_BITRIX24_FORM_WEBHOOK_KEY`

Presencia verificada en VPS:

- si

### Runtime DevExpress Evaluate API: secrets

Incorporado a partir de la documentacion tecnica bajo `untracked/`.

Ejemplo de host para documentacion publica:

- `https://internal-api.example.local:5050`

Endpoints documentados:
  - `/api/Empresa/Evaluate`
  - `/api/Empresa/EvaluateObj`
  - `/api/Empresa/EvaluateList`

Secret cargado en runtime:

- `DEVEXPRESS_EVALUATE_API_BASE_URL`

En la infraestructura actual corresponde a:

- `SECRET_DEVEXPRESS_EVALUATE_API_BASE_URL`

Uso esperado desde un flow:

- `{{ secret('DEVEXPRESS_EVALUATE_API_BASE_URL') }}`

Importante:

- en `kestra/platform/infra/.env` el valor se guarda Base64-encoded bajo `SECRET_DEVEXPRESS_EVALUATE_API_BASE_URL`
- se guarda solo el base URL
- los paths concretos de la API siguen definidos por la automatizacion que la consuma
- el valor real no debe copiarse en `.env.example` ni en documentacion publica versionada

### Runtime Analisis Credito: webhook secret

Referenciado hoy desde el flow `kestra/automations/analisis-credito/flows/renovacion_cruz_del_eje.yaml`.

Secret cargado en runtime:

- `ANALISIS_CREDITO_WEBHOOK_KEY`

En la infraestructura actual corresponde a:

- `SECRET_ANALISIS_CREDITO_WEBHOOK_KEY`

Uso esperado desde un flow:

- `{{ secret('ANALISIS_CREDITO_WEBHOOK_KEY') }}`

Importante:

- en `kestra/platform/infra/.env` el valor se guarda Base64-encoded bajo `SECRET_ANALISIS_CREDITO_WEBHOOK_KEY`
- el valor real no debe copiarse en `.env.example` ni en documentacion publica versionada
- es la key efectiva del path del webhook, por lo que debe tratarse como secreto

### Runtime Analisis Credito: incoming MetaMap webhook secret

Referenciado hoy desde el flow `kestra/automations/analisis-credito/flows/incoming_metamap_bridge.yaml`.

Secret cargado en runtime:

- `ANALISIS_CREDITO_INCOMING_METAMAP_WEBHOOK_KEY`

En la infraestructura actual corresponde a:

- `SECRET_ANALISIS_CREDITO_INCOMING_METAMAP_WEBHOOK_KEY`

Uso esperado desde un flow:

- `{{ secret('ANALISIS_CREDITO_INCOMING_METAMAP_WEBHOOK_KEY') }}`

Importante:

- en `kestra/platform/infra/.env` el valor se guarda Base64-encoded bajo `SECRET_ANALISIS_CREDITO_INCOMING_METAMAP_WEBHOOK_KEY`
- el valor real no debe copiarse en `.env.example` ni en documentacion publica versionada
- es la key efectiva del path del webhook, por lo que debe tratarse como secreto

## Cuando Usar Cada Tipo

Usar `envs` cuando el dato no es sensible:

- URLs base
- nombres o IDs de campos
- timeouts
- codigos funcionales
- estados de negocio

Usar `secret(...)` cuando el dato es sensible:

- tokens
- passwords
- webhook paths privados
- keys de webhook
- credenciales de integracion

## Convencion Recomendada De Nombres

### Para variables no sensibles

En flow:

- `{{ envs.crm_api_base_url }}`
- `{{ envs.crm_timeout_seconds }}`

En infraestructura:

- `ENV_CRM_API_BASE_URL`
- `ENV_CRM_TIMEOUT_SECONDS`

### Para secrets

En flow:

- `{{ secret('CRM_API_TOKEN') }}`

En infraestructura:

- `SECRET_CRM_API_TOKEN`

Regla practica:

- prefijo del dominio
- nombre explicito
- no mezclar mayusculas y minusculas al azar
- no reutilizar nombres genericos como `TOKEN` o `BASE_URL`

## Como Sumar Una Variable Nueva A Kestra

En la implementacion actual, agregar una variable nueva implica tocar tanto la repo como la configuracion operativa de Kestra.

### Paso 1. Decidir si es `envs` o `secret(...)`

Preguntas utiles:

- si se filtra, genera riesgo de seguridad
- si cambia entre instalaciones, es solo configuracion funcional

Si no es sensible, usar `envs`.

Si es sensible, usar `secret(...)`.

### Paso 2. Definir el nombre

Ejemplo para dominio `crm`:

- variable no sensible: `crm_api_base_url`
- secret: `CRM_API_TOKEN`

En infraestructura eso se convierte en:

- `ENV_CRM_API_BASE_URL`
- `SECRET_CRM_API_TOKEN`

### Paso 3. Referenciarla en el flow

Ejemplo:

```yaml
env:
  CRM_API_BASE_URL: "{{ envs.crm_api_base_url }}"
  CRM_API_TOKEN: "{{ secret('CRM_API_TOKEN') }}"
```

### Paso 4. Declararla en la infraestructura versionada

Agregar la nueva clave en:

- `kestra/platform/infra/.env.example`
- `kestra/platform/infra/docker-compose.yml`

Ejemplo en `.env.example`:

```dotenv
ENV_CRM_API_BASE_URL=https://api.example.com
SECRET_CRM_API_TOKEN=change-me
```

Ejemplo en `docker-compose.yml` dentro del servicio `kestra`:

```yaml
environment:
  ENV_CRM_API_BASE_URL: ${ENV_CRM_API_BASE_URL}
  SECRET_CRM_API_TOKEN: ${SECRET_CRM_API_TOKEN}
```

### Paso 5. Cargar el valor real en el entorno operativo

Importante:

- el valor real no se commitea en Git
- se carga en el `.env` operativo o mecanismo equivalente del servidor
- `kestra/platform/infra/.env.example` es solo una referencia de nombres
- la UI no es el mecanismo principal documentado para este setup

### Paso 6. Reiniciar Kestra para que tome la configuracion

Como la configuracion entra por variables del contenedor, Kestra necesita reiniciarse para leer nuevos valores.

En la implementacion actual esto implica actualizar el servicio desplegado con la nueva configuracion de entorno.

### Paso 7. Probar el flow en dev

Validar al menos:

- que el flow renderiza la expresion sin error
- que la tarea recibe la variable esperada
- que el valor nuevo produce el comportamiento esperado

### Paso 8. Documentarla

Actualizar:

- este documento si la variable es transversal o relevante para operar la repo
- `kestra/automations/<dominio>/docs/` si es especifica del dominio
- el PR, explicando que se agrego configuracion nueva

## Checklist Corto Para Variables Nuevas

1. decidir si es variable o secret
2. nombrarla con prefijo del dominio
3. usarla en el flow
4. agregarla a `.env.example`
5. agregarla a `docker-compose.yml`
6. cargar valor real fuera del repo
7. reiniciar Kestra
8. probar en dev
9. documentarla

## Lo Que No Hace Falta Hacer

Agregar una variable nueva no implica automaticamente:

- crear un ambiente nuevo en GitHub
- crear un tenant nuevo en Kestra
- crear un namespace nuevo fuera del patron actual
- crear otra instancia de Kestra

## Limite Importante Del Modelo Actual

La configuracion de runtime cargada por `ENV_` y `SECRET_` vive a nivel de instancia Kestra, no a nivel de namespace dentro de esta repo.

Consecuencia practica:

- si dev y prod comparten la misma instancia, estas variables no quedan aisladas por namespace solo por usar `envs` y `secret(...)`
- cambiar una variable global de la instancia impacta potencialmente a cualquier flow que la consuma en cualquier namespace de esa instancia

Esto no bloquea el modelo actual, pero si en el futuro dev y prod necesitan valores distintos dentro de la misma instancia, habra que definir una estrategia mas fina.

## Referencias

- `kestra/platform/infra/.env.example`
- `kestra/platform/infra/docker-compose.yml`
- `kestra/automations/marketing-crm/flows/bitrix24_form_webhook.yaml`
- `kestra/automations/marketing-crm/files/bitrix24_form_flow/README.md`
