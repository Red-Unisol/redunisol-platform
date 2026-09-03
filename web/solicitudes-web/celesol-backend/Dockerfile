# Imagen del backend de solicitudes-web (Node 22 + Express + Prisma).
#
# Construccion multi-stage: tres etapas. Las dos primeras existen solo para
# producir artefactos; Docker las descarta al final. La imagen que se despliega
# es la ultima, y no contiene ni TypeScript ni compiladores.
#
# Probar en local, parado en celesol-backend/:
#   docker build -t celesol-backend:test .
#
# Referencia del patron: web/redunisol-web/docker/common/php-fpm/Dockerfile


# ============================================================
# Etapa 1 -- builder: compila TypeScript a JavaScript
# ============================================================

# node:22-slim es Debian, NO Alpine. Es a proposito: Prisma sobre Alpine (musl)
# necesita configurar binaryTargets especificos y es una fuente clasica de
# errores dificiles de diagnosticar. Debian slim funciona con la configuracion
# por defecto de Prisma.
FROM node:22-slim AS builder

# Crea /app dentro del contenedor y se para ahi. Todo lo que sigue es relativo
# a esa carpeta.
WORKDIR /app

# -----------------------------------------------------------
# El ORDEN de las proximas instrucciones es la decision mas importante
# del archivo.
#
# Docker cachea el resultado de cada instruccion. Al reconstruir, compara linea
# por linea: si una instruccion y sus archivos no cambiaron, reusa el resultado
# anterior en vez de ejecutarla de nuevo.
#
# Como en el dia a dia cambia el CODIGO y casi nunca las dependencias, copiamos
# primero package.json/package-lock.json solos e instalamos. Asi un cambio en
# src/ no invalida el cache de las 362 librerias, y el build pasa de ~2 minutos
# a unos segundos.
#
# Si aca hicieramos "COPY . ." cualquier cambio en cualquier archivo obligaria
# a bajar todas las librerias otra vez.
# -----------------------------------------------------------
COPY package.json package-lock.json ./

# npm ci = instalar EXACTAMENTE las versiones fijadas en package-lock.json
# (a diferencia de "npm install", que puede resolver versiones distintas segun
# el dia). Garantiza que la imagen sea reproducible.
#
# --ignore-scripts evita el script "prepare" -> husky, que busca un repositorio
# git. Dentro de la imagen no hay .git y tiraria un warning inutil.
RUN npm ci --ignore-scripts

# Prisma genera codigo TypeScript a partir de prisma/schema.prisma (los tipos
# de Socio, Solicitud, User, etc.). Sin este paso tsc no encuentra esos tipos y
# la compilacion falla. Verificado en la Fase 1.
COPY prisma ./prisma
RUN npx prisma generate

# Recien ahora el codigo fuente, que es lo que cambia seguido.
COPY tsconfig.json ./
COPY src ./src

# tsc traduce src/**/*.ts a JavaScript en dist/. Si hay un error de tipos, el
# build se detiene aca -- que es exactamente lo que queremos: fallar en el
# pipeline y no en produccion.
#
# NOTA: tsconfig.json no excluye los *.test.ts, asi que dist/ incluye 110
# archivos de test. No es grave (dist/ pesa 2,8 MB) pero es peso innecesario.
# Se limpia agregando un tsconfig.build.json que los excluya.
RUN npm run build


# ============================================================
# Etapa 2 -- deps: node_modules solo con lo necesario para EJECUTAR
# ============================================================

# Empieza de cero. Esta etapa tiene un unico proposito: producir un
# node_modules SIN las herramientas de compilacion.
FROM node:22-slim AS deps

# Prisma detecta la version de OpenSSL del sistema al GENERAR el cliente, y
# elige el motor de consultas segun eso. Si openssl no esta instalado, la
# deteccion falla y elige por defecto debian-openssl-1.1.x, que despues no
# coincide con la imagen final (3.0.x): la app arranca pero no puede consultar
# la base.
# Tiene que instalarse ANTES de "npx prisma generate".
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

# package.json tiene dos listas de librerias:
#   - dependencies:    lo que la app necesita para funcionar (Express, Prisma,
#                      bcrypt, zod, nodemailer...)
#   - devDependencies: lo que solo sirve para desarrollar y compilar
#                      (TypeScript, ESLint, tsx...)
#
# --omit=dev baja solamente la primera lista. Si en vez de esto copiaramos el
# node_modules de la etapa builder, nos llevariamos TypeScript y ESLint al
# servidor de produccion, donde no se usan nunca.
RUN npm ci --omit=dev --ignore-scripts

# Excepcion necesaria: el CLI "prisma" esta en devDependencies, pero el
# entrypoint lo usa en CADA arranque para "prisma migrate deploy". Lo agregamos
# a mano, con la version clavada para que coincida con @prisma/client (6.19.3).
#
# Alternativa mas prolija, pero que toca el codigo de la app: mover "prisma" de
# devDependencies a dependencies en package.json.
RUN npm install --no-save --omit=dev --ignore-scripts prisma@6.19.3

# El cliente de Prisma se genera segun la plataforma, asi que hay que generarlo
# tambien en esta etapa: es el node_modules que termina en la imagen final.
COPY prisma ./prisma
RUN npx prisma generate


# ============================================================
# Etapa 3 -- production: la imagen que realmente se despliega
# ============================================================
FROM node:22-slim AS production

# Prisma necesita openssl para la conexion cifrada con Postgres.
#
# Los tres comandos van encadenados con && en un SOLO RUN a proposito: cada RUN
# crea una capa en la imagen. Si fueran instrucciones separadas, el "rm -rf" de
# la tercera no achicaria nada, porque el indice de paquetes (~40 MB) ya
# quedaria guardado en la capa anterior.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Muchas librerias de Node miran esta variable para desactivar modo debug y
# activar optimizaciones. Express es una de ellas.
ENV NODE_ENV=production

# -----------------------------------------------------------
# Aca se ve para que existieron las dos etapas anteriores.
#
# Nos traemos SOLO los resultados: el node_modules liviano de "deps" y el dist/
# compilado de "builder". TypeScript, ESLint y los compiladores se quedan en
# etapas que Docker descarta y nunca entran a esta imagen.
#
# --chown=node:node le da la propiedad de los archivos al usuario sin
# privilegios que va a correr la aplicacion.
# -----------------------------------------------------------
COPY --from=deps    --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist         ./dist

# package.json lo necesita Node para resolver "type": "module" y metadatos.
# prisma/ lo necesita "migrate deploy" en cada arranque (schema + migraciones).
COPY --chown=node:node package.json ./
COPY --chown=node:node prisma ./prisma

# La calculadora de riesgo es un .xlsx que el backend lee del disco en cada
# GET /api/riesgo/calculadora (RiesgoController: process.cwd() + docs/...).
# WORKDIR es /app, asi que el archivo tiene que quedar en /app/docs/.
#
# Sin esta linea el endpoint responde 404 "No se encontro el archivo de la
# calculadora de riesgo": anda en local, donde el proyecto esta completo, y
# falla en la imagen, que solo lleva lo que se copia explicitamente.
# La excepcion correspondiente esta en .dockerignore.
COPY --chown=node:node docs/calculadora-riesgo ./docs/calculadora-riesgo

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# sed elimina los retornos de carro de Windows (\r). Si el script se guarda en
# VS Code como CRLF, dentro del contenedor falla con "no such file or
# directory" -- error clasico y confusisimo, porque el archivo SI existe.
# Es un cinturon de seguridad; mismo truco que usa redunisol-web.
#
# chmod +x le da permiso de ejecucion: sin eso Linux se niega a correrlo.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/entrypoint.sh

# De aca en adelante todo corre con un usuario sin privilegios. Las imagenes
# oficiales de Node ya traen creado el usuario "node".
# Equivale al USER www-data de redunisol-web, y es lo contrario del
# user: "root" con el que corre hoy el contenedor de Kestra.
USER node

# Documenta en que puerto escucha la app (env.PORT, default 3001). No abre nada
# por si solo: quien decide la publicacion real es el "ports:" del compose.
EXPOSE 3001

# -----------------------------------------------------------
# Las unicas dos instrucciones de este archivo que se ejecutan al ARRANCAR el
# contenedor. Todo lo anterior corre una sola vez, al construir la imagen.
#
# Docker ejecuta el ENTRYPOINT pasandole el CMD como argumentos. Por eso el
# script termina con exec "$@": ese "$@" vale "node dist/server.js".
#
# Dejar el comando en CMD (y no fijo dentro del script) permite que la misma
# imagen corra procesos distintos, como hace queue-worker en redunisol-web.
# -----------------------------------------------------------
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/server.js"]
