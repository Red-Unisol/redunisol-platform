# Arquitectura De La Repo

## Objetivo

Esta monorepo versiona automatizaciones de Kestra en Git y usa Kestra como runtime de ejecucion.

La regla principal es simple:

- Git guarda la definicion de flows, namespace files, tests y docs
- Kestra ejecuta lo que fue versionado y desplegado

## Capas Actuales

Hoy conviven dos capas:

1. capa historica/manual fuera de esta monorepo
2. capa Git-managed dentro de `redunisol-kestra/`

La capa historica sigue existiendo en el workspace raiz `kestra-deploy/`.

La capa Git-managed es la que debe crecer de ahora en adelante.

## Estructura Principal

```text
automations/
  bitrix24/
  reporting/
  legacy/

platform/
  infra/
  system/

tools/

.github/workflows/

docs/
```

## Responsabilidad De Cada Carpeta

### `automations/`

Agrupa automatizaciones por dominio funcional.

Cada dominio puede contener:

- `flows/`: definiciones YAML de Kestra
- `files/`: namespace files, codigo Python y scripts auxiliares
- `docs/`: documentacion del dominio
- `tests/`: tests del dominio

La unidad principal de cambio de negocio vive aca.

### `platform/`

Agrupa componentes de plataforma compartidos.

#### `platform/infra/`

Contiene infraestructura operativa de la instancia:

- `docker-compose.yml`
- `application.yaml`
- configuracion de Apache
- notas operativas de infraestructura

#### `platform/system/`

Reserva espacio para flows del namespace system.

### `tools/`

Contiene scripts operativos que entienden la estructura de la monorepo.

Scripts actuales:

- `deploy_kestra.py`
- `validate_kestra.py`

Estos scripts son parte de la arquitectura. No son utilidades aisladas.

### `.github/workflows/`

Define el comportamiento de CI/CD:

- validacion en pull requests
- deploy automatico a dev
- deploy manual a prod

### `docs/`

Documentacion transversal de la repo.

## Modelo De Dominio

En esta monorepo, `dominio` es una unidad de organizacion Git.

No es un objeto nativo de Kestra, pero se usa como unidad para:

- estructura de carpetas
- ownership
- review
- tests
- documentacion
- deploy

Dominios presentes hoy:

- `bitrix24`
- `reporting`
- `legacy`

## Modelo De Namespace

En Kestra, el namespace es el contenedor runtime.

La convencion objetivo es:

- `redunisol.dev.<dominio>`
- `redunisol.prod.<dominio>`

Ejemplos:

- `redunisol.dev.bitrix24`
- `redunisol.prod.reporting`

El YAML del flow no define por si solo el namespace final de ejecucion. El deploy lo reescribe.

## Modelo De Ambientes

Los ambientes compartidos hoy son:

- `dev`
- `prod`

No se crea un ambiente nuevo por proyecto.

La separacion entre proyectos se modela por dominio y namespace, no por multiplicacion de ambientes.

Importante:

- esa separacion por namespace no implica aislamiento automatico de variables de entorno o secrets del runtime
- en la implementacion actual, la configuracion inyectada al contenedor de Kestra es global a la instancia

## Flujo De Artefactos

El flujo logico es este:

1. un cambio se versiona en Git
2. el pull request corre validaciones
3. al mergear a `main`, se puede desplegar a dev
4. un deploy a prod se hace de forma manual
5. Kestra ejecuta el contenido ya publicado

## Source Of Truth

La fuente de verdad es Git.

Consecuencia practica:

- no se deben editar flows en Kestra como forma normal de trabajo
- no se deben editar namespace files en runtime como si fueran fuente primaria
- cualquier cambio persistente debe vivir en la repo

## Relacion Entre Repo Y Runtime

La repo y la instancia Kestra no son equivalentes.

La repo define.

Kestra ejecuta.

Eso implica:

- puede haber artefactos historicos en runtime que no representan el futuro deseado
- el runtime actual puede convivir con flujos manuales e implementaciones Git-managed
- la estrategia de migracion debe ser explicita, no asumida

## Estado Actual Verificado

Al 2026-03-23 se verifico:

- instancia Kestra accesible en `http://kestra.redunisol.com.ar`
- tenant activo `main`
- flujo manual historico bajo `redunisol`
- flujo Git-managed validado en `redunisol.dev.bitrix24`

## Decisiones De Arquitectura Ya Tomadas

- Git es la fuente de verdad
- Kestra se trata como runtime centralizado
- dominio es una convencion de repo
- el namespace final se resuelve en deploy
- dev y prod son ambientes compartidos
- la configuracion de runtime actual entra por variables del contenedor Kestra via Docker Compose
- no hay RBAC fino operativo en Kestra hoy

## Implicancias Practicas

Cuando se agrega un dominio nuevo, no alcanza con crear archivos.

Tambien hay que revisar:

- deploy
- workflows
- ownership
- docs del dominio
- variables y secretos necesarios