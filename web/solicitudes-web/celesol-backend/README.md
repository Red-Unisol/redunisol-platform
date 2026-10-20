# Celesol Backend

Backend service for the Celesol loan management system.

## Revisión documental y legajo digital

El flujo de firma, propuesta automática y decisión humana obligatoria está en
[docs/document-review.md](docs/document-review.md). La propuesta nunca cambia el
estado por sí sola. Ambas decisiones y sus evidencias se conservan por separado.

## Integración con Transferencias

El contrato de la API, reservas, comprobantes y recuperación está en
[docs/transferencias-api.md](docs/transferencias-api.md).
La integración está deshabilitada por defecto y requiere una identidad de servicio.

## Tech Stack

- Node.js 22+
- TypeScript
- Express
- PostgreSQL
- Prisma
- Zod
- Swagger / OpenAPI
- ESLint
- Husky
- Docker / Docker Compose

## Project Structure

```bash
src/
├── app.ts
├── server.ts
├── config/
├── db/
├── docs/
├── middleware/
└── modules/

prisma/
├── schema.prisma
└── migrations/
```

## Main Folders

- `src/app.ts`: Express application configuration.
- `src/server.ts`: Server entry point and lifecycle handling.
- `src/config`: Application and environment configuration.
- `src/db`: Database client and persistence setup.
- `src/docs`: Swagger/OpenAPI documentation setup.
- `src/middleware`: Shared Express middlewares.
- `src/modules`: Business modules and domain-specific features.
- `prisma`: Prisma schema and database migrations.

## Environment Variables

Create a `.env` file using `.env.example` as reference.

```env
DATABASE_URL=
NODE_ENV=development
PORT=3001
```

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Default local URL:

```bash
http://localhost:3001
```

## Available Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
```

## Database

Generate Prisma client:

```bash
npm run prisma:generate
```

Run migrations:

```bash
npm run prisma:migrate
```

Open Prisma Studio:

```bash
npm run prisma:studio
```

## API Documentation

Swagger documentation is available at:

```bash
http://localhost:3001/api-docs
```

## Health Checks

```bash
GET /health
GET /health/db
```

## Development Guidelines

- Organize business logic by modules.
- Keep configuration, database access, documentation and middlewares separated.
- Use Prisma for database access.
- Use Zod for runtime validation when needed.
- Keep API documentation updated.
- Do not commit local `.env` files.
- Run linting and type checking before opening a PR.

## Cuenta QA de desarrollo

El usuario técnico `qa-beex-dev` es administrador activo exclusivo de
`https://solicitudes-dev.redunisol.com.ar`, con correo reservado `.invalid`, área
VENDEDORES y asignación automática deshabilitada. Fue creado el 2026-10-16 con
aprobación explícita para conservarlo y reutilizarlo en pruebas. Su clave generada
está únicamente en el `credentials.txt` local ignorado por Git.

`scripts/ensure-dev-qa-admin.mjs` conserva su estado deseado. Desde el directorio
del backend compilado, ejecutarlo sin argumentos sólo verifica. `--create` requiere
aprobación operacional y una clave generada privada en `BEEX_QA_ADMIN_PASSWORD`;
no modifica identidades existentes ni rota claves. Comprueba tanto el origen dev
como la base `solicitudes_web_dev` antes de consultar o modificar datos. No debe
invocarse automáticamente al desplegar. La cuenta permite entrar por la interfaz
y actuar como los usuarios de cada área para probar sus permisos efectivos.