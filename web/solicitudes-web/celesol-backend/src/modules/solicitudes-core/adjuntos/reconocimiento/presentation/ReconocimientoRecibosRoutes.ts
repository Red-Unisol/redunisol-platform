import { Router, type RequestHandler, type Request } from "express";
import multer from "multer";
import { z } from "zod";
import type { AuthUser } from "../../../../auth/domain/entities/User.entity";
import type { GetCurrentUserUseCase } from "../../../../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../../../../auth/presentation/AuthCookies";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import { canEditSolicitud } from "../../../application/services/SolicitudPermissions";
import { SolicitudesError } from "../../../../solicitudes/domain/solicitudes-errors";
import type { ConfiguracionReconocimientoRepository } from "../domain/ReconocimientoRecibo";
import type { AnalizarReciboUseCase } from "../application/AnalizarRecibo.use-case";

type Dependencies = {
  getCurrentUserUseCase: Pick<GetCurrentUserUseCase, "execute">;
  solicitudesRepository: SolicitudesCoreRepository;
  fieldAccessRulesRepository: SolicitudFieldAccessRulesRepository;
  configuracion: ConfiguracionReconocimientoRepository;
  analizar: AnalizarReciboUseCase;
  visibilidadGuard: RequestHandler<{ id?: string }>;
  maxFileSizeBytes: number;
};
export function createReconocimientoRecibosRoutes(d: Dependencies) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: d.maxFileSizeBytes },
  });
  const auth: RequestHandler = async (req, res, next) => {
    try {
      res.locals.recognitionUser = await d.getCurrentUserUseCase.execute(
        (req as Request & { cookies?: Record<string, string> }).cookies?.[
          ACCESS_TOKEN_COOKIE
        ],
      );
      next();
    } catch (error) {
      next(error);
    }
  };
  router.use(auth);
  router.get("/configuracion", async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await d.configuracion.get());
    } catch (error) {
      next(error);
    }
  });
  router.patch("/configuracion", async (req, res, next) => {
    try {
      if (!(res.locals.recognitionUser as AuthUser).isSystemAdmin)
        throw new SolicitudesError(
          "Solo administradores pueden cambiar esta configuración.",
          403,
        );
      const body = z
        .object({ habilitado: z.boolean() })
        .strict()
        .safeParse(req.body);
      if (!body.success)
        throw new SolicitudesError("Configuración inválida.", 400);
      res.json(await d.configuracion.update(body.data.habilitado));
    } catch (error) {
      next(error);
    }
  });
  const authorize: RequestHandler = async (req, res, next) => {
    try {
      const user = res.locals.recognitionUser as AuthUser;
      if (req.params.id) {
        const id = z.string().uuid().safeParse(req.params.id);
        if (!id.success) throw new SolicitudesError("Solicitud inválida.", 400);
        const solicitud = await d.solicitudesRepository.findById(id.data);
        if (!solicitud)
          throw new SolicitudesError("Solicitud no encontrada.", 404);
        const workflowOwnerCode = user.workflowOwnerId
          ? await d.solicitudesRepository.findWorkflowOwnerCodeById?.(
              user.workflowOwnerId,
            )
          : null;
        const rule = await d.fieldAccessRulesRepository.findByWorkflowStateId(
          solicitud.estadoActual.id,
        );
        if (
          !canEditSolicitud(
            { ...user, workflowOwnerCode },
            solicitud,
            "UPLOAD_ATTACHMENT",
            rule,
          )
        )
          throw new SolicitudesError(
            "No tenés permiso para incorporar adjuntos.",
            403,
          );
      } else {
        // Mismos requisitos del alta: usuario activo autenticado, área, usuario
        // legacy y nombre del vendedor. No crea solicitud ni archivo persistente.
        if (
          !user.workflowOwnerId ||
          !user.legacyUser?.trim() ||
          ![user.firstName, user.lastName].filter(Boolean).join(" ").trim()
        )
          throw new SolicitudesError(
            "No tenés permiso para el alta de solicitudes.",
            403,
          );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
  const analyze: RequestHandler = async (req, res, next) => {
    const controller = new AbortController();
    const close = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", close);
    try {
      if (req.aborted || res.destroyed) return;
      if (!req.file) throw new SolicitudesError("Archivo requerido.", 400);
      const result = await d.analizar.execute(
        {
          buffer: req.file.buffer,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) res.json(result);
    } catch (error) {
      next(error);
    } finally {
      res.off("close", close);
    }
  };
  router.post("/alta", authorize, upload.single("file"), analyze);
  router.post(
    "/:id/analizar",
    d.visibilidadGuard,
    authorize,
    upload.single("file"),
    analyze,
  );
  // Multer rechaza antes del proveedor; no afecta el guardado habitual.
  router.use(
    (
      error: unknown,
      _req: Request,
      _res: import("express").Response,
      next: import("express").NextFunction,
    ) => {
      next(
        error instanceof multer.MulterError
          ? new SolicitudesError(
              "Archivo inválido o demasiado grande para analizar.",
              400,
            )
          : error,
      );
    },
  );
  return router;
}
