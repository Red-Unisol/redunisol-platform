# Instructivo de deploy — Celesol

**Última actualización:** 29 de julio de 2026

> **Importante:** hoy no existe ningún ambiente de producción ni pipeline de deploy automatizado en ninguno de los tres repositorios. El CI de GitLab de `celesol-backend` y `celesol-frontend` solo valida (`lint` + `typecheck`/`test` + `build`), no publica ni despliega nada. No hay `Dockerfile` para backend ni frontend. `celesol-deploy` es explícitamente infraestructura de **desarrollo local** (Postgres + pgAdmin + MinIO vía Docker Compose), no un stack de producción. Este documento describe requisitos, variables de entorno y comandos de build/arranque de forma agnóstica de infraestructura — quien reciba el proyecto debe decidir dónde y cómo correr los procesos (VPS con Node directo, contenedores propios, PaaS, etc.) y adaptar estos pasos a esa infraestructura.

Cubre los tres repos:

- **celesol-backend** — API (Node.js 22+/Express/TypeScript/Prisma).
- **celesol-frontend** — SPA (React/Vite).
- **celesol-deploy** — infraestructura de Postgres/MinIO/pgAdmin vía Docker Compose (solo desarrollo local; en un ambiente productivo real, reemplazar por instancias gestionadas o el equivalente de infraestructura que corresponda).

## 1. Estado de ramas al momento de este documento

| Repo | Rama principal | Rama con trabajo en curso incluido en esta entrega |
|---|---|---|
| `celesol-backend` | `develop` |
| `celesol-frontend` | `develop` |
| `celesol-deploy` | `develop` | 

## 2. Prerrequisitos

- Node.js 22+ (misma versión mayor que usa el equipo en desarrollo) y npm.
- PostgreSQL 18.x accesible desde el backend.
- Un servidor S3-compatible (MinIO ) accesible desde el backend, para los adjuntos de solicitudes. **Nota:** la imagen `minio/minio` fue archivada en abril de 2026; `celesol-deploy` usa la última release pública antes del archivo (`RELEASE.2025-09-07T16-13-09Z`). Ver `celesol-deploy/MINIO_ALTERNATIVES.md` antes de comprometerse a esa imagen en producción.
- **Conectividad de red saliente desde el backend hacia el sistema legado Vimax** (`https://celesol.dyndns.org:5050` por defecto). Usa un certificado TLS válido emitido por una CA pública (Sectigo, vence el 17/12/2026) — no requiere confiar en ningún certificado ni configuración adicional de TLS. Sin esta conectividad no funcionan: el seed inicial, la sincronización de socios, la simulación de préstamos, ni ninguna de las rutas `/solicitudes-legacy/*`.
- Un proveedor SMTP (para verificación de email / recuperación de contraseña), salvo que se deje `MAIL_ENABLED=false` — igual hay que completar las variables `SMTP_*` con algún valor, son obligatorias en el schema de validación.
- Docker + Docker Compose si se va a usar `celesol-deploy` tal cual para la infraestructura de base de datos/storage.

## 3. Variables de entorno — backend

Copiar `celesol-backend/.env.example` a `.env` y completar. El backend valida esto al arrancar (`src/config/env.ts`) y **no levanta si falta o es inválida** alguna de estas variables:

| Variable | Descripción |
|---|---|
| `NODE_ENV` | `development` \| `test` \| `production`. |
| `PORT` | Puerto HTTP del backend (por defecto `3001`). |
| `APP_NAME` | Nombre de la app (usado en emails). |
| `APP_ORIGIN` | Origen del frontend, para CORS. Debe ser una URL válida y coincidir exactamente con el dominio real del frontend en producción. |
| `ACCESS_TOKEN_SECRET` | Secreto JWT, mínimo 32 caracteres. **Generar uno nuevo por ambiente**, nunca reusar el de `.env.example`/desarrollo. |
| `ACCESS_TOKEN_TTL_MINUTES` / `REFRESH_TOKEN_TTL_DAYS` | Duración de sesión, ajustar según política. |
| `EMAIL_VERIFICATION_CODE_TTL_MINUTES` / `PASSWORD_RESET_TOKEN_TTL_MINUTES` | TTLs de códigos/tokens por email. |
| `EMAIL_SEND_RATE_LIMIT_MAX` / `EMAIL_SEND_RATE_LIMIT_WINDOW_MINUTES` | Rate limit de envío de emails. |
| `LEGACY_API_BASE_URL` / `LEGACY_API_TIMEOUT_MS` | Host y timeout del servidor Vimax. |
| `ADJUNTOS_ALLOWED_EXTENSIONS` / `ADJUNTOS_ALLOWED_MIME_TYPES` / `ADJUNTOS_MAX_FILE_SIZE_BYTES` | Reglas de validación de archivos adjuntos. |
| `MINIO_ENDPOINT` / `MINIO_PORT` / `MINIO_USE_SSL` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET_SOLICITUDES` | Conexión al object storage. Ver sección 5. |
| `MAIL_ENABLED` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `DEFAULT_MAIL_SENDER` | Envío de emails transaccionales. Si se habilita, usar credenciales reales de un dominio propio, no Gmail personal. |
| `DATABASE_URL` | Connection string de Postgres. |

No commitear nunca el `.env` real (ya está en `.gitignore`).

## 4. Variables de entorno — frontend

Copiar `celesol-frontend/.env.example` a `.env` (o al mecanismo de env vars del hosting que se use para el build):

| Variable | Descripción |
|---|---|
| `VITE_API_BASE_URL` | URL pública del backend. Se hornea en el build de Vite — si cambia, hay que rebuildear el frontend, no alcanza con cambiar una variable en el servidor. |

## 5. Base de datos

```bash
cd celesol-backend
npx prisma generate
npx prisma migrate deploy   # NO usar "npm run prisma:migrate" (mapea a "prisma migrate dev", interactivo y pensado para desarrollo)
npx prisma db seed
```

- `migrate deploy` aplica las migraciones ya existentes en `prisma/migrations/` (incluida la inicial consolidada `20260724120000_init`) sin generar ninguna nueva ni pedir confirmación — es el comando correcto para un deploy no interactivo.
- `db seed` (`prisma/seed.ts`) hace dos cosas, en este orden:
  1. **Crea/actualiza una cuenta admin genérica de arranque**: `administrador@celesol.dev` / usuario `apajon` / contraseña `Password123!`, con área asignada a VENDEDORES. **Cambiar esta contraseña inmediatamente después del primer login** — queda en texto plano en el repo, pensada solo para poder entrar la primera vez.
  2. **Sincroniza todos los socios en vivo desde Vimax** (no hay ningún dato de socios versionado en el repo, a propósito, por ser PII real). Esto tarda 1-2 minutos y **falla si no hay conectividad a Vimax en ese momento** — si falla, se puede reintentar solo con `npx prisma db seed` (la cuenta admin ya creada no se duplica, es un upsert).

## 6. Object storage (MinIO)

El backend **no crea el bucket automáticamente** — no hay ningún `makeBucket`/`bucketExists` en el código. Antes de levantar el backend, crear a mano el bucket configurado en `MINIO_BUCKET_SOLICITUDES` (por ejemplo, con `mc mb` o la consola web de MinIO).

## 7. Backend — build y arranque

```bash
cd celesol-backend
npm ci
npm run build       # tsc -> dist/
npm start           # node dist/server.js
```

En producción, correr esto detrás de un proceso supervisado (systemd, pm2, contenedor con restart policy, etc.) — no hay un `Dockerfile` en el repo todavía, así que containerizar queda a criterio de cada ambiente.

### Verificación

- `GET /health` — debe responder `200 { ok: true }` sin depender de nada más.
- `GET /health/db` — valida conectividad real a Postgres.
- `GET /api-docs` — Swagger UI con el contrato completo de la API (útil para smoke-testear endpoints a mano). Considerar restringir o quitar esta ruta en producción si no se quiere exponer el contrato de la API públicamente.

## 8. Frontend — build y arranque

```bash
cd celesol-frontend
npm ci
npm run build        # tsc -b && vite build -> dist/
```

Servir el contenido de `dist/` como archivos estáticos (nginx, Caddy, un bucket con CDN, etc.), **configurando fallback a `index.html`** para que funcionen las rutas de React Router. No requiere un proceso Node corriendo en producción.

## 9. Reverse proxy / CORS

- `APP_ORIGIN` (backend) debe coincidir exactamente con el origen público del frontend, o el navegador va a bloquear las requests por CORS.
- El backend usa cookies HttpOnly para sesión (`accessToken`/`refreshToken`), con `secure: true` cuando `NODE_ENV=production` — si el frontend y el backend quedan en dominios distintos, revisar la configuración de cookies cross-site (`SameSite`, HTTPS) según corresponda.

## 10. Advertencias conocidas para quien despliegue

- El CI del backend corre lint, `prisma validate`, typecheck y build reales — es la señal de calidad confiable antes de un deploy.
- Los secretos en `.env.example` (JWT secret, credenciales de Postgres/MinIO/pgAdmin) son valores de desarrollo — **ninguno debe usarse en producción**.
- El sistema legado (Vimax) no tiene autenticación observada en sus endpoints. Usa TLS con un certificado válido de CA pública (Sectigo, vence el 17/12/2026) — no hace falta configurar nada especial de TLS, pero si Vimax no lo renueva antes de esa fecha, la integración se corta.

## 11. Checklist de verificación post-deploy

- [ ] Infraestructura de Postgres/MinIO definida y accesible (propia vía `celesol-deploy` o gestionada).
- [ ] `.env` de backend completo con secretos de producción regenerados (`ACCESS_TOKEN_SECRET` nuevo, credenciales de Postgres/MinIO reales).
- [ ] `.env` de frontend con `VITE_API_BASE_URL` apuntando al backend real.
- [ ] Migraciones aplicadas (`npx prisma migrate deploy`) y seed corrido (`npx prisma db seed`).
- [ ] `npm run build` exitoso en backend y frontend.
- [ ] `GET /health` y `GET /health/db` responden 200.
- [ ] Login con la cuenta admin genérica funciona, y su contraseña fue cambiada inmediatamente después.
- [ ] La lista de Socios carga (confirma bucket de MinIO + conectividad a Vimax + seed ejecutado correctamente).
- [ ] Se puede crear una solicitud de prueba y subir un adjunto (confirma MinIO end-to-end).
- [ ] Se puede simular un préstamo (confirma conectividad a Vimax desde el backend en producción, no solo en desarrollo).
- [ ] Acceso de red confirmado desde el backend hacia `LEGACY_API_BASE_URL`.

## 12. Seguridad

- Rotar `ACCESS_TOKEN_SECRET` por ambiente — nunca reusar el valor de `.env.example`.
- Cambiar la contraseña de la cuenta admin genérica del seed apenas se pueda loguear.
- Considerar restringir o quitar `/api-docs` en producción si no se quiere exponer el contrato de la API públicamente.
- Revisar que `MINIO_USE_SSL` y las credenciales de MinIO en producción no sean las de desarrollo (`minioadmin`/`minioadmin`).

## 13. Backups y rollback

- Backups periódicos de Postgres (incluye datos de socios, solicitudes, usuarios, catálogos de workflow).
- Los adjuntos viven en el bucket de MinIO — el backup de la base no incluye los archivos en sí.
- Como solo existe una migración consolidada, un rollback de esquema implica restaurar un backup de base previo, no revertir migraciones individuales.
