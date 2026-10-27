import type { Router } from "express";
import { z } from "zod";
import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { InitialLoanGenerationService } from "../infrastructure/services/InitialLoanGenerationService";
import { AdministrativeCorrectionError } from "../domain/workflow/AdministrativeCorrection";

export const initialLoanRecoveryInput = z.object({
  requestId: z.uuid(), expectedUpdatedAt: z.iso.datetime(),
  newLoanId: z.string().regex(/^[1-9]\d*$/),
  reason: z.string().trim().min(10).max(2000),
}).strict();

export function addInitialLoanGenerationRoutes(router: Router, deps: {
  auth: Pick<GetCurrentUserUseCase, "execute">;
  service: Pick<InitialLoanGenerationService, "recover">;
}) {
  router.post("/:id/loan-generation/recover", async (req, res, next) => {
    try {
      const user = await deps.auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      const id = z.uuid().parse(req.params.id);
      const input = initialLoanRecoveryInput.parse(req.body);
      res.setHeader("Cache-Control", "no-store");
      res.json(await deps.service.recover(id, { id: user.id, isSystemAdmin: user.isSystemAdmin, workflowOwnerId: user.workflowOwnerId ?? "" }, input));
    } catch (e) {
      next(e instanceof z.ZodError ? new AdministrativeCorrectionError("Revisá el préstamo, la reserva y el motivo obligatorio.", 400) : e);
    }
  });
}
