# Herramientas Red Unisol

Aplicacion interna para concentrar herramientas operativas de Red Unisol en un solo punto de acceso.

La primera herramienta implementada es Consulta Renovacion Cruz del Eje. El frontend esta hecho con React y la capa servidor con Laravel. No usa base de datos por ahora: el catalogo de herramientas y la configuracion viven en archivos de configuracion para mantener el despliegue simple.

## Objetivo

- centralizar accesos internos en una sola interfaz
- ocultar endpoints sensibles de Kestra detras de un proxy backend
- dejar una base lista para sumar nuevas herramientas sin redisenar la app
- poder correr localmente y tambien en contenedores Docker

## Estructura relevante

- `app/Http/Controllers/HerramientasController.php`: renderiza la app y proxya la consulta a Kestra
- `config/tools.php`: branding y catalogo de herramientas
- `resources/js/app.jsx`: interfaz React
- `resources/css/app.css`: estilos institucionales de la app
- `routes/web.php`: rutas web y endpoint interno del proxy
- `docker-compose.yml`: arranque local en contenedor
- `Dockerfile`: imagen de produccion con build frontend incluido

## Variables de entorno

Copiar `.env.example` a `.env` y completar al menos:

- `APP_KEY`
- `APP_URL`
- `ANALISIS_CREDITO_WEBHOOK_URL`
- `ANALISIS_CREDITO_TIMEOUT_SECONDS`

`ANALISIS_CREDITO_WEBHOOK_URL` debe apuntar al webhook completo expuesto por Kestra para el flow de analisis de credito. Esa URL queda solo del lado servidor y no se expone al navegador.

## Desarrollo local

Requisitos:

- PHP 8.4+
- Composer
- Node 22+
- npm

Instalacion:

```bash
php ../../composer install
npm install
cp .env.example .env
php artisan key:generate
```

Ejecucion:

```bash
php artisan serve --host=127.0.0.1 --port=3010
npm run dev
```

## Tareas de VS Code

Desde `Terminal > Run Task...` quedan disponibles estas tareas:

- `Herramientas: Start Local Dev`: levanta Laravel en `http://127.0.0.1:3010` y Vite en `http://127.0.0.1:5173`
- `Herramientas: Laravel Serve`: levanta solo el backend Laravel
- `Herramientas: Vite Dev`: levanta solo el frontend con recarga en caliente
- `Herramientas: Build Frontend`: genera el build de produccion
- `Herramientas: Docker Up`: prueba la app con Docker Compose

Para la prueba local normal alcanza con correr `Herramientas: Start Local Dev` y abrir `http://127.0.0.1:3010`.

## Docker

La app incluye una imagen basada en Apache + PHP y un `docker-compose.yml` simple para correrla aislada.

```bash
docker compose up --build
```

Expone la app en `http://127.0.0.1:3010`.

## Deploy Git-managed

La forma recomendada de deploy para esta app es que GitHub Actions construya la imagen Docker desde Git y despliegue en la VPS usando un `docker-compose.yml` de runtime.

Archivos de deploy:

- `.github/workflows/deploy-herramientas-dev.yml`
- `.github/workflows/deploy-herramientas-prod.yml`
- `deploy/docker-compose.vps.yml`

Comportamiento esperado:

- `dev`: deploy automatico al hacer push a `main` si hubo cambios en `web/herramientas/`
- `prod`: deploy manual via `workflow_dispatch`

En GitHub conviene crear dos environments:

- `herramientas-dev`
- `herramientas-prod`

Secrets esperados en ambos environments:

- `SSH_HOST`
- `SSH_PORT`
- `SSH_USER`
- `SSH_PRIVATE_KEY`
- `TARGET_DIR`
- `GHCR_USERNAME`
- `GHCR_TOKEN`
- `APP_BIND` ejemplo `127.0.0.1:3011:80` en dev o `127.0.0.1:3010:80` en prod
- `APP_NAME`
- `APP_ENV`
- `APP_DEBUG`
- `APP_URL`
- `APP_KEY`
- `ANALISIS_CREDITO_WEBHOOK_URL`
- `ANALISIS_CREDITO_TIMEOUT_SECONDS`
- `LOG_CHANNEL`

Con este esquema, Git queda como fuente de verdad: Actions construye una imagen desde el commit y luego actualiza la instancia remota via Docker Compose.

## Agregar una nueva herramienta

1. sumar la metadata en `config/tools.php`
2. agregar la UI React correspondiente en `resources/js/app.jsx` o extraerla a componentes
3. crear un metodo backend si hace falta proxy o logica sensible
4. exponer la ruta en `routes/web.php`

## Nota operativa

Esta app no reemplaza Kestra como runtime. Solo ofrece una interfaz interna controlada desde Git para consumir automatizaciones y futuras herramientas operativas.
