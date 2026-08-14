import cors from "cors";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import swaggerUi from "swagger-ui-express";

import { env } from "./config/env";
import { prisma } from "./db/prisma";
import { swaggerSpec } from "./docs/swagger";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found-handler";
import {
  authRouter,
  getCurrentUserUseCase,
  usersRouter,
} from "./modules/auth/auth-module";
import { createRiesgoRouter } from "./modules/riesgo/riesgo-module";
import { createSociosRouter } from "./modules/socios/socios-module";
import {
  createFinSolicitudRouter,
  createSolicitudesCoreAdminRouter,
  createSolicitudesCoreRouter,
} from "./modules/solicitudes-core/solicitudes-core-module";
import { createSolicitudesLegacyRouter } from "./modules/solicitudes/solicitudes-module";

export const app = express();

app.use(
  cors({
    credentials: true,
    origin: env.APP_ORIGIN,
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/auth", authRouter);
app.use("/auth/users", usersRouter);
app.use(
  "/api/socios",
  createSociosRouter({
    getCurrentUserUseCase,
  }),
);
app.use(
  "/api/riesgo",
  createRiesgoRouter({
    getCurrentUserUseCase,
  }),
);
app.use(
  "/admin/solicitudes",
  createSolicitudesCoreAdminRouter({
    getCurrentUserUseCase,
  }),
);
app.use(
  "/solicitudes",
  createSolicitudesCoreRouter({
    getCurrentUserUseCase,
  }),
);
app.use(
  "/solicitudes-legacy",
  createSolicitudesLegacyRouter({
    getCurrentUserUseCase,
  }),
);
app.use("/api/redunisol", createFinSolicitudRouter());

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Check backend health
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Backend is running.
 */
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: "celesol-backend",
  });
});

/**
 * @openapi
 * /health/db:
 *   get:
 *     summary: Check PostgreSQL connectivity
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Database connection is available.
 *       500:
 *         description: Database connection failed.
 */
app.get(
  "/health/db",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.$queryRaw`SELECT 1`;

      res.status(200).json({
        database: "ok",
        ok: true,
        service: "celesol-backend",
      });
    } catch (error) {
      next(error);
    }
  },
);

app.use(notFoundHandler);
app.use(errorHandler);
