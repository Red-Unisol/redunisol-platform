import type { Router } from "express";
import { z } from "zod";
import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { InitialLoanGenerationService } from "../infrastructure/services/InitialLoanGenerationService";
import { AdministrativeCorrectionError } from "../domain/workflow/AdministrativeCorrection";
import type { LoanGenerationCheckService } from "../infrastructure/services/LoanGenerationCheckService";

export const generationCheckInput = z.object({ requestId: z.uuid(), expectedUpdatedAt: z.iso.datetime() }).strict();

export const initialLoanRecoveryInput = z.object({
  requestId: z.uuid(), expectedUpdatedAt: z.iso.datetime(),
  newLoanId: z.string().regex(/^[1-9]\d*$/),
  reason: z.string().trim().min(10).max(2000),
}).strict();

export function addInitialLoanGenerationRoutes(router: Router, deps: {
  auth: Pick<GetCurrentUserUseCase, "execute">;
  service: Pick<InitialLoanGenerationService, "recover">;
  checkService: Pick<LoanGenerationCheckService, "check" | "recover" | "release">;
  access: (id: string, user: Awaited<ReturnType<GetCurrentUserUseCase["execute"]>>) => Promise<unknown>;
}) {
  for (const action of ["check", "release", "recover-checked"] as const) {
    router.post(`/:id/loan-generation/${action}`, async (req, res, next) => {
      try {
        const user = await deps.auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
        const id = z.uuid().parse(req.params.id);
        await deps.access(id, user);
        const actor = { id: user.id, isSystemAdmin: user.isSystemAdmin, workflowOwnerId: user.workflowOwnerId ?? "" };
        res.setHeader("Cache-Control", "no-store");
        if (action === "check") res.json(await deps.checkService.check(id, actor, generationCheckInput.parse(req.body)));
        else if (action === "release") res.json(await deps.checkService.release(id, actor,
          generationCheckInput.extend({ reason: z.string().trim().min(10).max(2000) }).parse(req.body)));
        else res.json(await deps.checkService.recover(id, actor, initialLoanRecoveryInput.parse(req.body)));
      } catch (e) {
        next(e instanceof z.ZodError ? new AdministrativeCorrectionError("Actualizá la reserva y revisá el motivo de la recuperación.", 400) : e);
      }
    });
  }
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
