# Celesol — Módulos entregados

**Fecha:** 29 de julio de 2026
**Complementa a:**  `DEPLOY.md` (cómo instalarlo, paso a paso). Este documento es el inventario técnico de componentes: qué es cada pieza, dónde vive, y qué necesita para correr. No repite los comandos de instalación — para eso está la guía de deploy.

---

## 1. Backend (API)

| | |
|---|---|
| Repositorio | `celesol-backend` |
| Stack | Node.js 22+, Express 4, TypeScript, Prisma ORM |
| Puerto por defecto | `3001` (`env.PORT`, `src/server.ts`) |
| Autenticación | Cookies HttpOnly (`accessToken`/`refreshToken`) firmadas con JWT (`jsonwebtoken`), secreto en `ACCESS_TOKEN_SECRET` (mín. 32 caracteres). `secure: true` en producción — requiere HTTPS o el navegador descarta la cookie |
| Configuración | Centralizada y validada con Zod en `src/config/env.ts` — el proceso no arranca si falta o es inválida una variable requerida |
| Health checks | `GET /health` (liveness) · `GET /health/db` (conectividad con Postgres) |
| Envío de email | Opcional (`MAIL_ENABLED`), vía SMTP (`nodemailer`) — para verificación de email y reset de contraseña. **Nota:** las variables `SMTP_*` son obligatorias en el schema aunque `MAIL_ENABLED=false`; hay que completarlas igual con un valor (aunque no se use) o el proceso no levanta |
| Integración externa | Sistema legado Celesol/Vimax vía HTTPS (`LEGACY_API_BASE_URL`), certificado TLS válido emitido por una CA pública (Sectigo, vence el 17/12/2026) — no requiere configuración adicional de TLS. Sin autenticación observada en sus endpoints |

## 2. Documentación de API (Swagger / OpenAPI)

| | |
|---|---|
| Generador | `swagger-jsdoc` (OpenAPI 3.0.0), servido con `swagger-ui-express` |
| Ruta servida | `/api-docs` (montada en `src/app.ts`) |
| Fuente | Anotaciones JSDoc distribuidas por módulo en `celesol-backend/src/docs/swagger/*.swagger.ts` (socios, solicitudes-core, field-access-admin, workflow-transition-admin, riesgo, fin-solicitud, solicitud-adjuntos, solicitud-cancelaciones) |
| Configuración | `src/docs/swagger.ts` — no requiere variables de entorno propias, se genera a partir del código en cada arranque |

## 3. Frontend (aplicación web)

| | |
|---|---|
| Repositorio | `celesol-frontend` |
| Stack | React + Vite + TypeScript |
| Build | `npm run build` → carpeta `dist/` (bundle estático) |
| Servido | Cualquier servidor de archivos estáticos (nginx, Caddy, bucket + CDN, etc.) — **requiere configurar fallback a `index.html`** para que funcionen las rutas de React Router al refrescar/entrar directo a una URL interna |
| Configuración | Una sola variable: `VITE_API_BASE_URL` (URL pública del backend). Se resuelve en **build time**, no en runtime — cambiar la URL del backend requiere rebuildear el frontend, no alcanza con cambiar una variable en el servidor |
| Puerto dev | `5173` (Vite dev server, solo desarrollo local — no aplica al build de producción) |

## 4. Base de datos (PostgreSQL)

| | |
|---|---|
| Motor | PostgreSQL 18.x |
| Conexión | Connection string en `DATABASE_URL` (backend) |
| Administración | ORM Prisma desde el backend — no hay acceso directo a la base fuera de eso salvo herramientas externas (pgAdmin, `psql`, etc.) |

## 5. Modelo de base de datos (Prisma)

| | |
|---|---|
| Definición del esquema | `celesol-backend/prisma/schema.prisma` |
| Migraciones versionadas | `celesol-backend/prisma/migrations/` — aplicar con `npx prisma migrate deploy` (no interactivo) en un deploy real |
| Datos iniciales (seed) | `celesol-backend/prisma/seed.ts` — crea una cuenta de administrador de sistema bootstrap y **trae datos de socios en vivo desde Vimax** al momento de correrlo (no es un fixture estático) |

## 6. Almacenamiento de archivos (MinIO)

| | |
|---|---|
| Uso | Adjuntos de solicitudes (documentación cargada por el vendedor/analista) |
| Cliente | SDK oficial `minio` (no AWS SDK — es un cliente S3-compatible dedicado) |
| Configuración | `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_USE_SSL`, `MINIO_BUCKET_SOLICITUDES` |
| ⚠️ Importante | **El bucket no se crea solo.** No hay ningún código en el backend que ejecute `makeBucket`/`bucketExists` — el bucket configurado en `MINIO_BUCKET_SOLICITUDES` tiene que existir de antemano (creado a mano vía consola de MinIO o `mc mb`) antes de que el backend pueda subir el primer adjunto |
| Imagen de referencia (dev) | Ver `celesol-deploy/MINIO_ALTERNATIVES.md` antes de elegir imagen para producción |

## 7. Infraestructura de desarrollo local (`celesol-deploy`)

| | |
|---|---|
| Contenido | Docker Compose con Postgres 18.3 + pgAdmin 9.14.0 + MinIO |
| Alcance | **Explícitamente solo desarrollo local** — no es un stack de producción, no tiene TLS ni secretos productivos |
| Uso | `docker compose up -d` + `bash scripts/healthcheck.sh` para validar que los 3 servicios respondan |

## 8. Lo que NO se entrega (para que no se asuma que existe)

- Sin `Dockerfile` para backend ni frontend.
- Sin pipeline de CI/CD que publique o despliegue — el CI de GitLab de ambos repos solo valida (`lint`/`typecheck`/`test`/`build`).
- Sin ambiente de producción propio hoy.
- Sin creación automática del bucket de MinIO (ver punto 6).
- El `npm test` del frontend es un placeholder (`"No tests configured yet"`) — no corre los ~15+ archivos `*.test.ts` que sí existen en el repo. No usarlo como señal de calidad.
