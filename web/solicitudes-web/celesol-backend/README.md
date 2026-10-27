# Celesol Backend

Backend service for the Celesol loan management system.

## Recuperación de sesión

La tolerancia de 30 segundos para respuestas perdidas, las reglas de revocación
y la validación local están en [docs/session-recovery.md](docs/session-recovery.md).

## Revisión documental y legajo digital

El flujo de firma, propuesta automática y decisión humana obligatoria está en
[docs/document-review.md](docs/document-review.md). La propuesta nunca cambia el
estado por sí sola. Ambas decisiones y sus evidencias se conservan por separado.

## Integración con Transferencias

El contrato de la API, reservas, comprobantes y recuperación está en
[docs/transferencias-api.md](docs/transferencias-api.md).
La integración está deshabilitada por defecto y requiere una identidad de servicio.

## Edición del convenio al generar préstamos

`POST /solicitudes/:id/prestamo-legacy` admite, por ejemplo,
`{"convenio":{"caja40":{"original":100,"valor":110}}}`. Solo se escriben los
campos editados; cada campo requiere el valor mostrado al empezar a editar.
Si ese campo cambió en Vimarx, devuelve `409 ConvenioSocioConflictError` sin
editar el socio ni generar el préstamo. El operador debe cerrar y reabrir el
modal para revisar los valores actuales. Los reintentos cuyo valor ya quedó
guardado no vuelven a escribirlo.

El frontend conserva la referencia original durante las recargas de fondo.
El backend compara con una lectura nueva antes de editar. Lectura y escritura
en Vimarx son llamadas separadas, por lo que este control no es una comparación
y escritura atómica frente a cambios externos ocurridos entre ambas llamadas.
Frontend y backend deben desplegarse juntos: el formato anterior con el convenio
completo sin valores originales se rechaza para evitar sobrescrituras.

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
