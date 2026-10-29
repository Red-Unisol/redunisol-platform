import type { Router } from "express";
import { z } from "zod";
import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import { AdministrativeCorrectionError } from "../domain/workflow/AdministrativeCorrection";
import type { RefinanciacionCobrosService } from "../infrastructure/services/RefinanciacionCobrosService";

const common = {
  operationId: z.uuid(), expectedUpdatedAt: z.iso.datetime(), reason: z.string().trim().min(10).max(2000),
};
export const refinanciacionRecoveryInput = z.discriminatedUnion("resolution", [
  z.object({ ...common, resolution: z.literal("CONFIRMED"), cobroId: z.string().regex(/^[1-9]\d*$/), totalCobrado: z.number().positive().finite().multipleOf(0.01) }).strict(),
  z.object({ ...common, resolution: z.literal("NOT_APPLIED") }).strict(),
]);

export function addRefinanciacionCobrosRoutes(router: Router, deps: {
  auth: Pick<GetCurrentUserUseCase, "execute">;
  service: Pick<RefinanciacionCobrosService, "inspect" | "recover">;
}) {
  router.get("/:id/refinanciacion/cobro-pendiente", async (req, res, next) => {
    try {
      const user = await deps.auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      res.setHeader("Cache-Control", "no-store");
      res.json(await deps.service.inspect(z.uuid().parse(req.params.id), user));
    } catch (error) { next(error); }
  });
  router.post("/:id/refinanciacion/conciliar", async (req, res, next) => {
    try {
      const user = await deps.auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      res.setHeader("Cache-Control", "no-store");
      res.json(await deps.service.recover(z.uuid().parse(req.params.id), user, refinanciacionRecoveryInput.parse(req.body)));
    } catch (error) {
      next(error instanceof z.ZodError ? new AdministrativeCorrectionError("Revisá la operación, la evidencia y el motivo de la conciliación.", 400) : error);
    }
  });
}
