import type { Router } from "express";
import { z } from "zod";
import type { GetCurrentUserUseCase } from "../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import { AdministrativeCorrectionError } from "../domain/workflow/AdministrativeCorrection";
import type { LoanReliquidationService } from "../infrastructure/services/LoanReliquidationService";
import { loanReplacementInput } from "./ControlledLoanReplacementRoutes";

export function addLoanReliquidationRoutes(router: Router, deps: {
  auth: Pick<GetCurrentUserUseCase, "execute">;
  service: Pick<LoanReliquidationService, "view" | "reopen" | "prepare">;
}) {
  for (const action of ["view", "reopen", "prepare"] as const) {
    router[action === "view" ? "get" : "post"](action === "prepare" ? "/:id/reliquidacion/preparar" : "/:id/reliquidacion", async (req, res, next) => {
      try {
        const user = await deps.auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
        const id = z.uuid().parse(req.params.id);
        res.setHeader("Cache-Control", "no-store");
        res.json(action === "view" ? await deps.service.view(id, user)
          : await deps.service[action](id, user, loanReplacementInput.parse(req.body)));
      } catch (e) {
        next(e instanceof z.ZodError ? new AdministrativeCorrectionError("Revisá el préstamo, la versión y el motivo (mínimo 10 caracteres).", 400) : e);
      }
    });
  }
}
