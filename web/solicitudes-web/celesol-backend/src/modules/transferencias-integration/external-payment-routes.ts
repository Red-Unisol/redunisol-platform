import type { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { GetCurrentUserUseCase } from "../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../auth/presentation/AuthCookies";
import { IntegrationError } from "./domain";
import { externalPaymentInput } from "./external-payment-input";
import type { ExternalPaymentService } from "./ExternalPaymentService";

// Mounted on the solicitud router, after its existing visibility guard.
export function addExternalPaymentRoutes(
  router: Router,
  deps: {
    auth: Pick<GetCurrentUserUseCase, "execute">;
    service: Pick<ExternalPaymentService, "view" | "register">;
    maxFileBytes: number;
  },
) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: deps.maxFileBytes,
      files: 1,
      fields: 4,
      fieldSize: 16000,
    },
  }).single("file");
  router.use("/:id/pago-externo", async (req, res, next) => {
    try {
      res.locals.externalPaymentUser = await deps.auth.execute(
        req.cookies?.[ACCESS_TOKEN_COOKIE],
      );
      res.setHeader("Cache-Control", "no-store");
      next();
    } catch (e) {
      next(e);
    }
  });
  router.get("/:id/pago-externo", async (req, res, next) => {
    try {
      res.json(
        await deps.service.view(
          z.uuid().parse(req.params.id),
          res.locals.externalPaymentUser,
        ),
      );
    } catch (e) {
      next(
        e instanceof z.ZodError
          ? new IntegrationError("INVALID_REQUEST", "Solicitud inválida.", 400)
          : e,
      );
    }
  });
  router.post("/:id/pago-externo", (req, res, next) => {
    upload(req, res, (error) => {
      if (error)
        return next(
          new IntegrationError(
            "INVALID_RECEIPT",
            error.code === "LIMIT_FILE_SIZE"
              ? "El comprobante supera el tamaño permitido."
              : "Adjuntá un único comprobante.",
            error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
          ),
        );
      void (async () => {
        const id = z.uuid().parse(req.params.id);
        const input = externalPaymentInput.parse(req.body);
        if (!req.file)
          throw new IntegrationError(
            "MISSING_RECEIPT",
            "Adjuntá el comprobante de la transferencia.",
            400,
          );
        res.json(
          await deps.service.register(
            id,
            res.locals.externalPaymentUser,
            input,
            req.file.buffer,
          ),
        );
      })().catch((e) =>
        next(
          e instanceof z.ZodError
            ? new IntegrationError(
                "INVALID_REQUEST",
                "Revisá la fecha, la referencia y el comentario del pago.",
                400,
              )
            : e,
        ),
      );
    });
  });
  return router;
}
