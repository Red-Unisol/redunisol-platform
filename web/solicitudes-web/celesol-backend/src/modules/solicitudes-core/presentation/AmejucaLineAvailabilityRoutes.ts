import { Router } from "express";
import { z } from "zod";
import type { DbClient } from "../../../db/prisma";
import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ForbiddenSystemAdminOnlyError } from "../../auth/domain/auth-errors";
import { actingContext } from "../../auth/impersonation/context";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import {
  ForbiddenSolicitudAccessError,
  InvalidSolicitudesCoreRequestError,
} from "../domain/solicitudes-core-errors";
import {
  AMEJUCA_VARIANTS,
  isAmejucaLineAvailable,
} from "../domain/services/AmejucaLineAvailability";
import type { LineasPrestamoCatalog } from "../domain/services/LineasPrestamoCatalog";
import {
  readAmejucaLineAvailability,
  setAmejucaLineAvailability,
} from "../infrastructure/services/AmejucaLineAvailabilityStore";

type Auth = Pick<GetCurrentUserUseCase, "execute">;
const changeBody = z
  .object({
    variant: z.enum(AMEJUCA_VARIANTS),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export function addLineasPrestamoParaAltaRoute(
  router: Router,
  auth: Auth,
  catalog: Required<Pick<LineasPrestamoCatalog, "listVigentesByLegacyUser">>,
  db: Pick<DbClient, "amejucaLineAvailability">,
) {
  router.get("/lineas-prestamo-para-alta", async (req, res, next) => {
    try {
      const user = await auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      if (!user.workflowOwnerId) throw new ForbiddenSolicitudAccessError();

      const lineas = await catalog.listVigentesByLegacyUser(user.legacyUser);
      const { variant } = await readAmejucaLineAvailability(db);
      const disponibles = lineas.filter((linea) =>
        isAmejucaLineAvailable(linea.oid, variant),
      );
      res.setHeader("Cache-Control", "no-store");
      res.json(disponibles);
    } catch (error) {
      next(error);
    }
  });
}

export function createAmejucaLineAvailabilityAdminRouter(
  auth: Auth,
  db: DbClient,
) {
  const router = Router();
  router.get("/amejuca-line-availability", async (req, res, next) => {
    try {
      const user = await auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      if (!user.isSystemAdmin) throw new ForbiddenSystemAdminOnlyError();

      const current = await readAmejucaLineAvailability(db);
      res.setHeader("Cache-Control", "no-store");
      res.json(current);
    } catch (error) {
      next(error);
    }
  });

  router.put("/amejuca-line-availability", async (req, res, next) => {
    try {
      const user = await auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      if (!user.isSystemAdmin) throw new ForbiddenSystemAdminOnlyError();

      const parsed = changeBody.safeParse(req.body);
      if (!parsed.success)
        throw new InvalidSolicitudesCoreRequestError(
          "Elegí una variante válida de AMEJUCA.",
        );
      const actorId = actingContext.getStore()?.administrator.id ?? user.id;
      const current = await setAmejucaLineAvailability(
        db,
        parsed.data.variant,
        parsed.data.expectedVersion,
        actorId,
      );
      res.setHeader("Cache-Control", "no-store");
      res.json(current);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
