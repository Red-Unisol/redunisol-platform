# Guia Corta De Trabajo

Esta repo guarda automatizaciones de Kestra.

Reglas base:

- cada proyecto nuevo vive dentro de `automations/`
- los cambios entran por pull request
- no se crea un ambiente nuevo por proyecto
- la configuracion va en variables y secretos de Kestra

## Donde va cada cosa

```text
automations/
  <dominio>/
    flows/
    files/
    docs/
    tests/
```

Que va en cada carpeta:

- `automations/<dominio>/flows/`: flows YAML de Kestra
- `automations/<dominio>/files/`: codigo Python, scripts y namespace files
- `automations/<dominio>/docs/`: notas de uso, contrato API, decisiones del dominio
- `automations/<dominio>/tests/`: tests del dominio

Archivos utiles del repo:

- `tools/deploy_kestra.py`: deploy a Kestra
- `tools/validate_kestra.py`: validacion basica del repo
- `docs/README.md`: documentacion tecnica transversal
- `automations/bitrix24/`: ejemplo completo para copiar estructura

## Como crear una automatizacion nueva

Ejemplo: nuevo dominio `crm`.

### 1. Crear la carpeta

```text
automations/
  crm/
    flows/
    files/
    docs/
    tests/
```

### 2. Crear el flow

Archivo:

```text
automations/crm/flows/alta_cliente.yaml
```

### 3. Agregar codigo si hace falta

Si el flow usa Python o archivos auxiliares:

```text
automations/crm/files/crm_flow/main.py
```

### 4. Documentar lo minimo

Archivo sugerido:

```text
automations/crm/docs/README.md
```

Poner al menos:

- que hace
- que recibe
- que devuelve
- que variables o secretos usa

### 5. Agregar tests si hay logica

Archivo sugerido:

```text
automations/crm/tests/test_main.py
```

### 6. Si es un dominio nuevo, sumarlo al deploy

Hoy el deploy conoce:

- `bitrix24`
- `reporting`
- `legacy`

Si agregas otro dominio, hay que tocar:

- `tools/deploy_kestra.py`
- `.github/workflows/deploy-dev.yml`
- `.github/workflows/deploy-prod.yml`

## Como hacer un pull request

### 1. Crear una rama

Ejemplos:

- `feat/crm-alta-cliente`
- `fix/reporting-timeout`

### 2. Hacer cambios y subir la rama

```bash
git push -u origin <tu-rama>
```

### 3. Abrir el PR en GitHub

En el PR explicar:

- que cambia
- como probarlo
- si necesita variables nuevas en Kestra

### 4. Esperar `Validate`

No mergear directo a `main`.

## Como usar variables de entorno de Kestra

No crear un ambiente nuevo por proyecto.

Ya trabajamos con ambientes compartidos:

- `dev`
- `prod`

Cada dominio se despliega en su namespace:

- `redunisol.dev.<dominio>`
- `redunisol.prod.<dominio>`

## Que usar

Usa `envs` para datos no sensibles:

- URLs
- IDs de campos
- timeouts
- estados

Usa `secret(...)` para datos sensibles:

- tokens
- passwords
- webhook keys

## Ejemplo simple

```yaml
env:
  CRM_API_BASE_URL: "{{ envs.crm_api_base_url }}"
  CRM_TIMEOUT_SECONDS: "{{ envs.crm_timeout_seconds }}"
  CRM_API_TOKEN: "{{ secret('CRM_API_TOKEN') }}"
```

Regla simple:

- si es configuracion, usar `envs`
- si es secreto, usar `secret(...)`
- no hardcodear valores en el YAML o en Python

## Resumen rapido

1. crear `automations/<dominio>/`
2. poner YAML en `flows/`
3. poner codigo en `files/`
4. documentar en `docs/`
5. testear en `tests/`
6. abrir pull request
7. usar `envs` y `secret(...)` de Kestra