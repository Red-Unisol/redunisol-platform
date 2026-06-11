# Zipline

Servicio Git-managed para que Marketing suba imagenes y obtenga URLs publicas.

## Dev

- URL prevista: `http://media-dev.redunisol.com.ar`
- runtime: `/opt/zipline-dev`
- bind interno: `127.0.0.1:3040`
- imagen: canal `v4` fijado por digest en el runtime env
- datos persistentes: `/opt/zipline-dev/data`

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

El workflow deja el vhost en `/opt/zipline-dev/apache/`. La activacion en el
Apache frontal se hace una vez, despues de crear el DNS:

1. apuntar `media-dev.redunisol.com.ar` a la VPS
2. instalar `apache/media-dev-redunisol.conf` en el directorio incluido por Apache
3. validar con `apachectl -t`
4. recargar Apache

Esta primera etapa usa HTTP. HTTPS se agrega despues de emitir el certificado;
en ese cambio tambien debe pasarse `CORE_RETURN_HTTPS_URLS=true` y
`PUBLIC_URL=https://media-dev.redunisol.com.ar`.

## Primer ingreso

En el primer acceso Zipline muestra el setup para crear el super-admin. El
registro publico y las invitaciones quedan desactivados. Los usuarios de
Marketing se crean desde el panel por un super-admin.

## Backup

Respaldar juntos:

- un dump consistente de PostgreSQL generado con `pg_dump`
- `/opt/zipline-dev/data/uploads`
- `/opt/zipline-dev/data/public`
- `/opt/zipline-dev/data/themes`

No copiar `data/postgres` en caliente como mecanismo normal de backup. Tampoco
alcanza con exportar solo la configuracion desde el panel: los uploads viven en
el filesystem local.
