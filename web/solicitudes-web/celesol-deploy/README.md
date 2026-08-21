# celesol-deploy

Infraestructura de desarrollo local para Celesol. Levanta PostgreSQL, pgAdmin y MinIO con un solo comando.

---

## Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (o Docker Engine + Compose plugin)
- `bash` para ejecutar los scripts auxiliares

---

## Inicio rápido

```bash
cp .env.example .env
docker compose up -d
```

Los servicios quedan accesibles en:

| Servicio | URL / Host | Credenciales (por defecto) |
|---|---|---|
| **PostgreSQL** | `localhost:${POSTGRES_HOST_PORT}` | `celesol` / `celesol_dev` |
| **pgAdmin** | http://localhost:${PGADMIN_HOST_PORT} | `admin@celesol.dev` / `admin` |
| **MinIO API (S3)** | http://localhost:9000 | `minioadmin` / `minioadmin` |
| **MinIO Console** | http://localhost:9001 | `minioadmin` / `minioadmin` |

> Edita `.env` antes de levantar si querés usar credenciales distintas.

---

## Versiones

| Imagen | Versión |
|---|---|
| `postgres` | `18.3` |
| `dpage/pgadmin4` | `9.14.0` |
| `minio/minio` | `RELEASE.2025-09-07T16-13-09Z` |

> **Nota sobre MinIO:** el repositorio original `minio/minio` fue archivado en abril 2026.
> La versión usada es la última release pública antes del archivo. Ver
> [MINIO_ALTERNATIVES.md](MINIO_ALTERNATIVES.md) para opciones de reemplazo.

---

## Variables de entorno

Copiá `.env.example` a `.env` y ajustá los valores:

```dotenv
# PostgreSQL
POSTGRES_HOST_PORT=5432
POSTGRES_DB=celesol
POSTGRES_USER=celesol
POSTGRES_PASSWORD=celesol_dev

# pgAdmin
PGADMIN_HOST_PORT=5050
PGADMIN_DEFAULT_EMAIL=admin@celesol.dev
PGADMIN_DEFAULT_PASSWORD=admin

# MinIO
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
```

Si ya tenés PostgreSQL o pgAdmin usando esos puertos en tu máquina, cambiá solo los
puertos publicados en tu `.env` local. Por ejemplo:

```dotenv
POSTGRES_HOST_PORT=55432
PGADMIN_HOST_PORT=5051
```

Dentro de Docker, los servicios siguen usando sus puertos internos:

```text
postgres:5432
pgadmin:80
```

> **pgAdmin:** el email debe ser un dominio válido (ej. `.dev`, `.com`). pgAdmin 9.x rechaza
> dominios reservados como `.local` o `.internal`.

---

## Script de healthcheck

Verifica que los tres servicios estén levantados y accesibles desde el host:

```bash
bash scripts/healthcheck.sh
```

Salida esperada:

```
▸ PostgreSQL  (localhost:${POSTGRES_HOST_PORT})
  ✔ pg_isready: accepting connections
  ✔ SQL query OK  →  PostgreSQL 18.3 ...

▸ pgAdmin  (http://localhost:${PGADMIN_HOST_PORT})
  ✔ HTTP 200 — /misc/ping

▸ MinIO API  (http://localhost:9000)
  ✔ HTTP 200 — /minio/health/live
  → mc (MinIO client) not installed — skipping bucket check

▸ MinIO Console  (http://localhost:9001)
  ✔ HTTP 200 — console reachable

All checks passed.
```

### Qué verifica cada sección

| Servicio | Checks |
|---|---|
| PostgreSQL | `pg_isready` (TCP + auth) y una query SQL real |
| pgAdmin | HTTP 200 en `/misc/ping` (endpoint de liveness interno) |
| MinIO API | HTTP 200 en `/minio/health/live` (endpoint oficial de liveness) |
| MinIO Console | HTTP 200/301/302 en el puerto de la consola web |

El script sale con código `1` si algún check falla, lo que lo hace apto para usar en CI.

### Nota sobre el mensaje `→ mc not installed`

La línea en amarillo sobre `mc` **no es un error** — es un check opcional de credenciales
que solo corre si tenés instalada la CLI de MinIO (`mc`) en tu máquina host.

El check obligatorio de MinIO (HTTP `/minio/health/live`) ya confirma que el servidor está
activo y aceptando conexiones. El check de `mc` va un paso más y valida que las credenciales
sean correctas haciendo un `mc ls` autenticado.

Si querés habilitarlo, instalá `mc` en tu sistema:

```bash
# macOS
brew install minio/stable/mc

# Linux (amd64)
curl -O https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x mc && sudo mv mc /usr/local/bin/

# Windows (scoop)
scoop install mc
```

Una vez instalado, el script lo detecta automáticamente y lo usa sin ningún cambio.

---

## Comandos útiles

```bash
# Ver estado de los contenedores
docker compose ps

# Ver logs de un servicio específico
docker compose logs -f postgres
docker compose logs -f pgadmin
docker compose logs -f minio

# Detener todo (conserva volúmenes)
docker compose down

# Detener y eliminar volúmenes (borra todos los datos)
docker compose down -v

# Reiniciar un servicio
docker compose restart minio
```

---

## Estructura del repositorio

```
.
├── docker-compose.yml        # Definición de servicios
├── .env.example              # Plantilla de variables de entorno
├── .env                      # Variables locales (no commitear)
├── scripts/
│   └── healthcheck.sh        # Verificación de servicios desde el host
└── MINIO_ALTERNATIVES.md     # Guía de alternativas a MinIO
```
