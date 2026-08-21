# Imagen del frontend de solicitudes-web (React + Vite, servido por nginx).
#
# Probar en local, parado en celesol-frontend/:
#   docker build -t celesol-frontend:test .


# ============================================================
# Etapa 1 -- builder: compila la SPA
# ============================================================
FROM node:22-slim AS builder

WORKDIR /app

# Igual que en el backend: dependencias primero, para aprovechar el cache.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# -----------------------------------------------------------
# ARG = variable que existe SOLO durante el "docker build".
# (ENV, en cambio, existe dentro del contenedor al ejecutarlo.)
#
# Tiene que ser ARG porque Vite REEMPLAZA import.meta.env.VITE_API_BASE_URL por
# su valor literal dentro del JavaScript al compilar. Queda escrito en el
# archivo: cambiarlo despues en el servidor no tiene ningun efecto.
#
# El valor por defecto sirve para probar en local. En el pipeline se pasa el
# real:
#   docker build --build-arg VITE_API_BASE_URL=https://api-solicitudes-dev.redunisol.com.ar .
#
# Mismo patron que usa redunisol-web con ARG VITE_TRACKING_DEBUG.
# -----------------------------------------------------------
ARG VITE_API_BASE_URL=http://localhost:3001
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY . .

# tsc -b && vite build -> genera dist/
RUN npm run build

# ============================================================
# Etapa 2 -- production: nginx sirviendo los archivos estaticos
# ============================================================
FROM nginx:alpine AS production

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Solo el resultado del build. Node, Vite, TypeScript y los 664 MB de
# node_modules se quedan en la etapa anterior y nunca entran a esta imagen.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]