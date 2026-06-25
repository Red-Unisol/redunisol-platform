# Zipline

Servicio Git-managed para que Marketing suba imagenes y obtenga URLs publicas.

## Dev

- URL prevista: `https://media-dev.redunisol.com.ar`
- runtime: `/opt/zipline-dev`
- bind interno: `127.0.0.1:3040`
- imagen: canal `v4` fijado por digest en el runtime env
- datos persistentes: `/opt/zipline-dev/data`

## Prod

- URL prevista: `https://media.redunisol.com.ar`
- runtime: `/opt/zipline-prod`
- bind interno: `127.0.0.1:3041`
- imagen: canal `v4` fijado por digest en el runtime env
- datos persistentes: `/opt/zipline-prod/data`

Git versiona Compose, el vhost, el workflow y el runtime env cifrado. PostgreSQL,
uploads, themes, usuarios y sesiones son estado mutable de la VPS.

## Deploy

El workflow `Deploy Zipline Dev`:

1. descifra `zipline.dev.env.enc`
2. sube Compose, `.env` y el vhost a una carpeta temporal
3. valida la configuracion
4. levanta PostgreSQL y la imagen inmutable de Zipline
5. espera un `200` de `/api/healthcheck`
6. persiste los archivos efectivos en `/opt/zipline-dev`

El workflow `Deploy Zipline Prod`:

1. corre manualmente desde `main`
2. descifra `zipline.prod.env.enc`
3. sube Compose, `.env` y el vhost a una carpeta temporal
4. valida la configuracion
5. levanta PostgreSQL y la imagen inmutable de Zipline
6. espera un `200` de `/api/healthcheck`
7. persiste los archivos efectivos en `/opt/zipline-prod`

Los workflows dejan el vhost versionado en `/opt/zipline-*/apache/`. La
activacion en el Apache frontal se hace una vez, despues de crear DNS y
certificado:

1. apuntar `media-dev.redunisol.com.ar` o `media.redunisol.com.ar` a la VPS
2. emitir el certificado Let's Encrypt con webroot `/opt/apache/htdocs`
3. instalar el vhost correspondiente en el directorio incluido por Apache
4. validar con `apachectl -t`
5. recargar Apache

## Primer ingreso

En el primer acceso Zipline muestra el setup para crear el super-admin. El
registro publico y las invitaciones quedan desactivados. Los usuarios de
Marketing se crean desde el panel por un super-admin.

## Backup

Respaldar juntos:

- un dump consistente de PostgreSQL generado con `pg_dump`
- `/opt/zipline-*/data/uploads`
- `/opt/zipline-*/data/public`
- `/opt/zipline-*/data/themes`

No copiar `data/postgres` en caliente como mecanismo normal de backup. Tampoco
alcanza con exportar solo la configuracion desde el panel: los uploads viven en
el filesystem local.
