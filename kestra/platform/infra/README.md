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

`KESTRA_VERSION` debe permanecer fijada a `v2.0.0`. No usar `latest` ni
`nightly`: una recreacion del contenedor podria incorporar cambios incompatibles
sin un cambio equivalente en Git.

## Levantar el stack

```bash
mkdir -p /opt/kestra/data/postgres /opt/kestra/data/storage /opt/kestra/data/credixsa-cache /opt/kestra/tmp
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

## Retencion local de logs

El contenedor de Kestra usa `json-file` con 10 archivos de hasta 500 MB
(`max-size: "500m"`, `max-file: "10"`): aproximadamente 5 GB de historial
local por contenedor. La cantidad de dias depende del volumen generado.
Este limite no reserva espacio por adelantado ni cambia el nivel de logging.
PostgreSQL mantiene su politica independiente de 3 archivos de 10 MB.

Cambiar estas opciones requiere recrear el contenedor de Kestra; `restart`
no las aplica. Antes de recrearlo, exportar con `docker logs --timestamps`
los registros necesarios para investigaciones, ya que pertenecen al contenedor
anterior. La retencion local no sustituye la conservacion centralizada.

## Ajuste de PostgreSQL

El servicio `postgres` arranca con parametros propios (`command:` en
`docker-compose.yml`), porque la configuracion de fabrica genera demasiada
escritura para el disco de la VPS:

- `shared_buffers=1GB` (fabrica 128MB): mas cache propio; el cache hit era 92,6%.
- `checkpoint_timeout=15min` (fabrica 5min) y `max_wal_size=4GB` (fabrica 1GB):
  menos checkpoints (eran 286 por dia) y menos paginas completas escritas al WAL.
- `wal_compression=lz4` (fabrica off): comprime esas paginas antes de escribirlas.

Aplicado en octubre de 2026. La medicion de antes y despues esta fuera del repo,
en la documentacion del area de Run.
