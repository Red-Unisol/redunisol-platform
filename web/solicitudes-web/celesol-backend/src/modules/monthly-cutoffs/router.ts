import { Router } from "express";
import { z } from "zod";
import type { GetCurrentUserUseCase } from "../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../auth/presentation/AuthCookies";
import { actingContext } from "../auth/impersonation/context";
import {
  canManageMonthlyCutoffs,
  MonthlyCutoffError,
  type MonthlyCutoffService,
} from "./domain";
const bodySchema = z
  .object({
    cutoffDate: z.string(),
    note: z.string().max(1000).nullable().optional(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export function createMonthlyCutoffRouter(
  auth: Pick<GetCurrentUserUseCase, "execute">,
  service: MonthlyCutoffService,
) {
  const router = Router();
  router.get("/amejuca/:period", async (req, res, next) => {
    try {
      const user = await auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      const result = await service.get(String(req.params.period));
      const canManage = canManageMonthlyCutoffs(user);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        ...result,
        history: canManage ? result.history : [],
        canManage,
      });
    } catch (error) {
      next(error);
    }
  });
  router.put("/amejuca/:period", async (req, res, next) => {
    try {
      const user = await auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success)
        throw new MonthlyCutoffError(
          "Revisá la fecha, la observación y la versión del corte.",
        );
      await service.save(
        String(req.params.period),
        parsed.data,
        user,
        actingContext.getStore()?.administrator.id ?? user.id,
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({
        ...(await service.get(String(req.params.period))),
        canManage: true,
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
