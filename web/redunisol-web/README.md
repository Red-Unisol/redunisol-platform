# Red Unisol

Aplicación web desarrollada con **Laravel 12**, **FilamentPHP 4**, **React 19** e **Inertia.js 2**.

## Stack Tecnológico

| Categoría | Tecnología | Versión |
|-----------|------------|---------|
| **Backend** | PHP | 8.4 |
| | Laravel | 12.x |
| | FilamentPHP | 4.x |
| | Inertia.js (Server) | 2.x |
| | Laravel Fortify | 1.x |
| **Frontend** | React | 19.x |
| | TypeScript | 5.x |
| | Inertia.js (Client) | 2.x |
| | Tailwind CSS | 4.x |
| | Vite | 7.x |
| **Base de Datos** | PostgreSQL | 18 |
| **Cache/Queue** | Redis | Alpine |
| **Containerización** | Docker | 20.10+ |

---

## Requisitos Previos

Antes de comenzar, asegúrate de tener instalado:

- **Docker** (versión 20.10 o superior)
- **Docker Compose** (versión 2.0 o superior)
- **Git**

### Verificar instalación

```bash
# Verificar Docker
docker --version
# Salida esperada: Docker version 20.10.x o superior

# Verificar Docker Compose
docker compose version
# Salida esperada: Docker Compose version v2.x.x

# Verificar Git
git --version
```

---

## Estructura del Proyecto

```
red-unisol/
├── app/                          # Código PHP de Laravel
│   ├── Actions/                  # Acciones de Fortify
│   ├── Filament/                 # Recursos de FilamentPHP
│   ├── Http/
│   │   ├── Controllers/
│   │   └── Middleware/
│   ├── Models/
│   └── Providers/
├── bootstrap/                    # Arranque de Laravel
├── config/                       # Configuración de Laravel
├── database/
│   ├── factories/
│   ├── migrations/
│   └── seeders/
├── docker/                       # Configuración de Docker
│   ├── common/
│   │   └── php-fpm/             # Dockerfile PHP-FPM
│   ├── development/
│   │   ├── nginx/               # Config Nginx desarrollo
│   │   ├── php-fpm/             # Entrypoint desarrollo
│   │   └── workspace/           # Dockerfile workspace
│   └── production/
│       ├── nginx/               # Dockerfile Nginx producción
│       └── php-fpm/             # Entrypoint producción
├── public/                       # Assets públicos
├── resources/                    # Frontend React/TypeScript
│   ├── css/
│   └── js/
│       ├── components/          # Componentes React
│       ├── hooks/               # Custom hooks
│       ├── layouts/             # Layouts de Inertia
│       ├── lib/                 # Utilidades
│       ├── pages/               # Páginas de Inertia
│       └── types/               # Tipos TypeScript
├── routes/                       # Rutas de Laravel
├── storage/                      # Almacenamiento
├── tests/                        # Tests con Pest
├── compose.dev.yml              # Docker Compose desarrollo
├── composer.json                # Dependencias PHP
├── package.json                 # Dependencias Node.js
├── vite.config.ts               # Configuración de Vite
└── .env.example                 # Variables de entorno ejemplo
```

---

## Guía de Instalación Paso a Paso

### Paso 1: Clonar el Repositorio

```bash
# Clonar el repositorio
git clone <URL_DEL_REPOSITORIO> red-unisol

# Entrar al directorio del proyecto
cd red-unisol
```

### Paso 2: Configurar Variables de Entorno

Crear el archivo `.env` copiando el ejemplo:

```bash
cp .env.example .env
```

Editar el archivo `.env` y configurar las siguientes variables clave:

```env
# Configuración de la aplicación
APP_NAME="Red Unisol"
APP_ENV=local
APP_DEBUG=true
APP_URL=http://localhost:8000

# Configuración de la base de datos PostgreSQL
# IMPORTANTE: DB_HOST debe ser el nombre del servicio en Docker
DB_CONNECTION=pgsql
DB_HOST=postgres        # Nombre del servicio Docker (localhost si ejecutas fuera de Docker)
DB_PORT=5432
DB_DATABASE=red-unisol
DB_USERNAME=admin
DB_PASSWORD=solva123

# Configuración de Redis
REDIS_CLIENT=predis
REDIS_HOST=redis        # Nombre del servicio Docker
REDIS_PASSWORD=null
REDIS_PORT=6379
```

### Paso 3: Iniciar los Contenedores de Docker

Iniciar PostgreSQL y Redis usando Docker Compose:

```bash
# Iniciar los servicios en segundo plano
docker compose -f compose.dev.yml up -d

# Verificar que los contenedores estén corriendo
docker compose -f compose.dev.yml ps
```

Deberías ver algo similar a:

```
NAME                    STATUS          PORTS
red-unisol-postgres-1   Up              0.0.0.0:5432->5432/tcp
red-unisol-redis-1      Up              6379/tcp
```

### Paso 4: Construir el Contenedor Workspace (Opcional pero Recomendado)

El contenedor **workspace** proporciona un entorno aislado con PHP 8.4 y Node.js 22 preconfigurados. Esto es útil si no deseas instalar estas herramientas en tu sistema local.

```bash
# Construir el contenedor workspace
docker build \
  -f docker/development/workspace/Dockerfile \
  --build-arg UID=$(id -u) \
  --build-arg GID=$(id -g) \
  -t red-unisol-workspace .
```

Para usar el workspace:

```bash
# Ejecutar el contenedor workspace de forma interactiva
docker run -it --rm \
  -v $(pwd):/var/www \
  -p 8000:8000 \
  -p 5173:5173 \
  --network red-unisol_laravel-development \
  red-unisol-workspace bash
```

> **Nota**: Los siguientes pasos pueden ejecutarse dentro del contenedor workspace o directamente en tu sistema local si tienes PHP 8.4 y Node.js 22 instalados.

### Paso 5: Instalar Dependencias de PHP (Composer)

```bash
# Instalar dependencias de Composer
composer install

# Si estás dentro del contenedor workspace:
# composer install
```

Este comando instalará todas las dependencias PHP definidas en `composer.json`, incluyendo:
- Laravel Framework
- FilamentPHP
- Inertia.js (servidor)
- Laravel Fortify
- Y más...

### Paso 6: Generar la Clave de la Aplicación

Laravel requiere una clave de aplicación única para encriptar datos:

```bash
php artisan key:generate
```

Esto actualizará automáticamente el valor `APP_KEY` en tu archivo `.env`.

### Paso 7: Instalar Dependencias de Node.js (NPM)

```bash
# Instalar dependencias de NPM
npm install
```

Este comando instalará todas las dependencias del frontend definidas en `package.json`, incluyendo:
- React 19
- Inertia.js (cliente)
- Tailwind CSS
- TypeScript
- Vite
- Radix UI
- Y más...

### Paso 8: Ejecutar las Migraciones de Base de Datos

Crear las tablas en la base de datos PostgreSQL:

```bash
php artisan migrate
```

Deberías ver una salida similar a:

```
INFO  Running migrations.

2025_01_01_000000_create_users_table ........................ DONE
2025_01_01_000001_create_cache_table ........................ DONE
2025_01_01_000002_create_jobs_table ......................... DONE
...
```

### Paso 9: Publicar Assets de FilamentPHP

FilamentPHP requiere que sus assets estén publicados:

```bash
# Publicar assets de Filament
php artisan filament:install --panels
```

Si te pregunta si deseas crear un usuario administrador, puedes responder **no** por ahora y crearlo después.

### Paso 10: Compilar Assets del Frontend

Para desarrollo, puedes compilar los assets una vez:

```bash
npm run build
```

O mantener Vite ejecutándose en modo desarrollo (recomendado):

```bash
npm run dev
```

### Paso 11: Iniciar el Servidor de Desarrollo

El proyecto incluye un script conveniente que inicia todos los servicios necesarios:

```bash
composer dev
```

Este comando inicia concurrentemente:
- **Servidor PHP** (`php artisan serve --host=0.0.0.0`) en `http://localhost:8000`
- **Queue Worker** (`php artisan queue:listen`)
- **Logs en tiempo real** (`php artisan pail`)
- **Vite Dev Server** (`npm run dev`) en `http://localhost:5173`

### Paso 12: Crear Usuario Administrador para FilamentPHP

Para acceder al panel de administración de Filament, necesitas crear un usuario:

```bash
php artisan make:filament-user
```

Sigue las instrucciones e ingresa:
- **Nombre**: Tu nombre
- **Email**: tu@email.com
- **Contraseña**: (tu contraseña segura)

---

## Acceso a la Aplicación

Una vez completados todos los pasos, podrás acceder a:

| Recurso | URL |
|---------|-----|
| **Aplicación Principal** | http://localhost:8000 |
| **Panel de Administración (Filament)** | http://localhost:8000/admin |
| **Vite Dev Server (HMR)** | http://localhost:5173 |

---

## Comandos Útiles

### Gestión de Docker

```bash
# Iniciar contenedores
docker compose -f compose.dev.yml up -d

# Detener contenedores
docker compose -f compose.dev.yml down

# Ver logs de los contenedores
docker compose -f compose.dev.yml logs -f

# Ver estado de los contenedores
docker compose -f compose.dev.yml ps

# Reiniciar contenedores
docker compose -f compose.dev.yml restart

# Eliminar contenedores y volúmenes (¡CUIDADO! Esto borra la base de datos)
docker compose -f compose.dev.yml down -v
```

### Comandos de Desarrollo

```bash
# Iniciar entorno de desarrollo completo
composer dev

# Solo servidor PHP
php artisan serve --host=0.0.0.0

# Solo Vite (frontend)
npm run dev

# Compilar assets para producción
npm run build

# Compilar con SSR
npm run build:ssr
```

### Comandos de Laravel

```bash
# Ejecutar migraciones
php artisan migrate

# Revertir migraciones
php artisan migrate:rollback

# Recrear base de datos (¡CUIDADO! Borra todos los datos)
php artisan migrate:fresh

# Ejecutar seeders
php artisan db:seed

# Migrar y sembrar
php artisan migrate:fresh --seed

# Limpiar cachés
php artisan optimize:clear

# Generar rutas de Wayfinder
php artisan wayfinder:generate
```

### Comandos de FilamentPHP

```bash
# Crear usuario administrador
php artisan make:filament-user

# Crear nuevo recurso
php artisan make:filament-resource NombreModelo

# Actualizar Filament
php artisan filament:upgrade
```

### Comandos de Testing

```bash
# Ejecutar todos los tests
composer test

# Ejecutar solo tests unitarios
php artisan test --testsuite=Unit

# Ejecutar solo tests de feature
php artisan test --testsuite=Feature

# Ejecutar test específico
php artisan test --filter=NombreDelTest
```

### Comandos de Linting y Formateo

```bash
# Lint PHP (Pint)
composer lint

# Verificar lint PHP sin cambios
composer test:lint

# Lint JavaScript/TypeScript (ESLint)
npm run lint

# Formatear código (Prettier)
npm run format

# Verificar formato sin cambios
npm run format:check

# Verificar tipos TypeScript
npm run types
```

---

## Acceso a la Base de Datos

### Desde la línea de comandos

```bash
# Conectar a PostgreSQL desde Docker
docker compose -f compose.dev.yml exec postgres psql -U admin -d red-unisol
```

### Credenciales por defecto

| Parámetro | Valor |
|-----------|-------|
| Host | `localhost` (desde tu máquina) o `postgres` (desde Docker) |
| Puerto | `5432` |
| Base de datos | `red-unisol` |
| Usuario | `admin` |
| Contraseña | `solva123` |

### Usando Laravel Tinker

```bash
# Iniciar Tinker
php artisan tinker

# Ejemplo: consultar usuarios
>>> User::all();
```

---

## Solución de Problemas Comunes

### Error: "Connection refused" a la base de datos

**Causa**: El contenedor de PostgreSQL no está corriendo o la configuración es incorrecta.

**Solución**:
```bash
# Verificar que el contenedor esté corriendo
docker compose -f compose.dev.yml ps

# Si no está corriendo, iniciarlo
docker compose -f compose.dev.yml up -d postgres

# Verificar logs por errores
docker compose -f compose.dev.yml logs postgres
```

### Error: "SQLSTATE[08006] Host not found"

**Causa**: El `DB_HOST` está mal configurado.

**Solución**:
- Si ejecutas **dentro de Docker**: `DB_HOST=postgres`
- Si ejecutas **fuera de Docker**: `DB_HOST=localhost` o `DB_HOST=127.0.0.1`

### Error: Permisos de archivos en storage/

**Solución**:
```bash
# Dar permisos de escritura
chmod -R 775 storage bootstrap/cache
```

### Error: Vite no conecta (HMR no funciona)

**Causa**: El puerto 5173 está bloqueado o Vite no está corriendo.

**Solución**:
```bash
# Verificar que el puerto no esté en uso
lsof -i :5173

# Matar proceso si está en uso
kill -9 <PID>

# Reiniciar Vite
npm run dev
```

### Error: "Class not found" después de instalar un paquete

**Solución**:
```bash
# Regenerar autoload de Composer
composer dump-autoload

# Limpiar cachés
php artisan optimize:clear
```

### Error: Migraciones fallan por tabla existente

**Solución**:
```bash
# Opción 1: Hacer rollback y migrar de nuevo
php artisan migrate:rollback
php artisan migrate

# Opción 2: Recrear la base de datos (BORRA TODOS LOS DATOS)
php artisan migrate:fresh
```

---

## Configuración de Xdebug (Opcional)

El proyecto incluye soporte para Xdebug. Para habilitarlo:

1. Asegúrate de que `XDEBUG_ENABLED=true` esté configurado en el build de Docker
2. Configura tu IDE (VS Code, PHPStorm) para escuchar en el puerto 9003
3. Usa `XDEBUG_IDE_KEY=DOCKER` como clave

---

## Arquitectura de la Aplicación

### Flujo de Peticiones

```
Browser → Nginx → PHP-FPM → Laravel → Inertia → React
                      ↓
                 PostgreSQL
                      ↓
                    Redis (cache/queue)
```

### Autenticación

La autenticación está manejada por **Laravel Fortify** e incluye:
- Login/Logout
- Registro de usuarios
- Recuperación de contraseña
- Verificación de email
- Autenticación de dos factores (2FA)

### Panel de Administración

**FilamentPHP** proporciona el panel de administración en `/admin` con:
- Gestión de recursos (CRUD)
- Dashboard personalizable
- Widgets
- Notificaciones

---

## Licencia

Este proyecto está bajo la licencia MIT.
