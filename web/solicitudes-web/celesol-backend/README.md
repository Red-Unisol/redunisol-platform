# Celesol Backend

Backend service for the Celesol loan management system.

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
