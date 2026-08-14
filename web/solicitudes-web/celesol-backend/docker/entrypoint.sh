#!/bin/sh
# Se ejecuta cada vez que arranca el contenedor, antes de la aplicacion.
#
# Mismo patron que web/redunisol-web/docker/production/php-fpm/entrypoint.sh
set -e

echo "==> Aplicando migraciones de base de datos"
# "migrate deploy" es la version NO interactiva: aplica las migraciones que ya
# existen en prisma/migrations/ y no genera ninguna nueva.
# NO usar "prisma migrate dev" aca -- ese pide confirmacion y crea migraciones.
npx prisma migrate deploy

echo "==> Iniciando aplicacion"
# "exec" reemplaza este script por el comando final, en vez de lanzarlo como
# proceso hijo. Asi la app queda como proceso principal del contenedor y recibe
# directo las señales de Docker (SIGTERM en "docker compose down"), pudiendo
# cerrar prolijo en vez de morir de golpe.
#
# "$@" son los argumentos que llegan desde el CMD del Dockerfile.
exec "$@"
