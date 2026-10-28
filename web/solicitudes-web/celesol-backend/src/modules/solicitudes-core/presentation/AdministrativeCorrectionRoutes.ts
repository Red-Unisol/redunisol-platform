import type { Router } from "express";
import { z } from "zod";
import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { AdministrativeCorrectionService } from "../infrastructure/services/AdministrativeCorrectionService";
import { AdministrativeCorrectionError } from "../domain/workflow/AdministrativeCorrection";

export const administrativeCorrectionInput = z.object({
  targetStateCode: z.literal("Revisar"),
  expectedUpdatedAt: z.iso.datetime(), requestId: z.uuid(),
  reason: z.string().trim().min(10).max(2000),
}).strict();
export const coreReconciliationInput = administrativeCorrectionInput
  .omit({ targetStateCode: true, requestId: true });

export function addAdministrativeCorrectionRoutes(router: Router, deps: {
  auth: Pick<GetCurrentUserUseCase, "execute">;
  service: Pick<AdministrativeCorrectionService, "view" | "correct" | "reconcile">;
}) {
  for (const operation of ["view", "correct", "reconcile"] as const) {
    const url = operation === "reconcile" ? "/:id/admin-core-reconciliation" : "/:id/admin-state-correction";
    router[operation === "view" ? "get" : "post"](url, async (req, res, next) => {
      try {
        const user = await deps.auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
        const id = z.uuid().parse(req.params.id);
        res.setHeader("Cache-Control", "no-store");
        res.json(operation === "view" ? await deps.service.view(id, user)
          : operation === "correct"
            ? await deps.service.correct(id, user, administrativeCorrectionInput.parse(req.body))
            : await deps.service.reconcile(id, user, coreReconciliationInput.parse(req.body)));
      } catch (error) {
        next(error instanceof z.ZodError
          ? new AdministrativeCorrectionError("Indicá un motivo de al menos 10 caracteres y actualizá el detalle de la solicitud.", 400)
          : error);
      }
    });
  }
  return router;
}
