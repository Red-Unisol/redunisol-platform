import type { Router } from "express";
import { z } from "zod";
import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { ControlledLoanReplacementService } from "../infrastructure/services/ControlledLoanReplacementService";
import { AdministrativeCorrectionError } from "../domain/workflow/AdministrativeCorrection";

export const loanReplacementInput = z.object({
  requestId: z.uuid(), expectedUpdatedAt: z.iso.datetime(),
  previousLoanId: z.string().regex(/^[1-9]\d*$/),
  reason: z.string().trim().min(10).max(2000),
}).strict();
export const loanReplacementRecoveryInput = loanReplacementInput.omit({ previousLoanId: true })
  .extend({ newLoanId: z.string().regex(/^[1-9]\d*$/) }).strict();

export function addControlledLoanReplacementRoutes(router: Router, deps: {
  auth: Pick<GetCurrentUserUseCase, "execute">;
  service: Pick<ControlledLoanReplacementService, "view" | "replace" | "recover">;
}) {
  for (const action of ["view", "replace", "recover"] as const) {
    const path = action === "recover" ? "/:id/admin-loan-replacements/recover" : "/:id/admin-loan-replacements";
    router[action === "view" ? "get" : "post"](path, async (req, res, next) => {
      try {
        const user = await deps.auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
        const id = z.uuid().parse(req.params.id);
        res.setHeader("Cache-Control", "no-store");
        res.json(action === "view" ? await deps.service.view(id, user) : action === "replace"
          ? await deps.service.replace(id, user, loanReplacementInput.parse(req.body))
          : await deps.service.recover(id, user, loanReplacementRecoveryInput.parse(req.body)));
      } catch (e) {
        next(e instanceof z.ZodError ? new AdministrativeCorrectionError("Revisá el ID, la versión de la solicitud y el motivo obligatorio.", 400) : e);
      }
    });
  }
}
