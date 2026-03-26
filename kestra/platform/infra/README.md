# Kestra Deploy

Stack minimo para correr Kestra en una VPS compartida, aislado via Docker Compose y operado como `root`.

## Estructura esperada en la VPS

```text
/opt/kestra
  |- .env
  |- application.yaml
  |- docker-compose.yml
  |- data/
  |  |- postgres/
  |  `- storage/
  `- tmp/
```

## Variables

Copiar `.env.example` a `.env` y completar:

- `POSTGRES_PASSWORD`
- `KESTRA_ADMIN_EMAIL`
- `KESTRA_ADMIN_PASSWORD`
- `KESTRA_PUBLIC_URL`

## Levantar el stack

```bash
mkdir -p /opt/kestra/data/postgres /opt/kestra/data/storage /opt/kestra/tmp
cd /opt/kestra
docker compose pull
docker compose up -d
docker compose ps
```

## Operacion diaria

```bash
cd /opt/kestra
docker compose logs -f kestra
docker compose restart
docker compose pull && docker compose up -d
```

## Publicacion

El stack expone Kestra solo en `127.0.0.1:8080` y `127.0.0.1:8081`. Para publicarlo hacia Internet, conviene poner Apache delante con reverse proxy desde un subdominio.
