import { timingSafeEqual } from "node:crypto";
import {
  Router,
  type ErrorRequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer from "multer";
import { z } from "zod";
import {
  confirmationSchema,
  fail,
  hash,
  IntegrationError,
  reserveSchema,
  type Actor,
} from "./domain";
import type { IntegrationConfig } from "./config";
import type { TransferenciasService } from "./TransferenciasService";

export function tokenMatches(
  authorization: string | undefined,
  expected: string,
): boolean {
  const match = /^Bearer ([^\s]{32,512})$/.exec(authorization ?? "");
  return Boolean(
    match &&
      /^[a-fA-F0-9]{64}$/.test(expected) &&
      timingSafeEqual(
        Buffer.from(hash(match[1]!), "hex"),
        Buffer.from(expected, "hex"),
      ),
  );
}
type User = {
  id: string;
  state: number;
  deletedAt: Date | null;
  isSystemAdmin: boolean;
  workflowOwner: { id: string; code: string; isActive: boolean } | null;
};
type Dependencies = {
  config: IntegrationConfig;
  service: TransferenciasService;
  findUser: (id: string) => Promise<User | null>;
  maxFileBytes: number;
};
export function createTransferenciasRouter(deps: Dependencies) {
  const router = Router();
  const actors = new WeakMap<Request, Actor>();
  const run =
    (
      work: (
        req: Request,
        res: Response,
        next: NextFunction,
      ) => Promise<unknown>,
    ) =>
    (req: Request, res: Response, next: NextFunction) => {
      void work(req, res, next).catch(next);
    };
  router.use(
    run(async (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      if (!deps.config.tokenSha256)
        fail("INTEGRATION_DISABLED", "Integración no habilitada.", 404);
      if (!tokenMatches(req.headers.authorization, deps.config.tokenSha256)) {
        res.setHeader("WWW-Authenticate", "Bearer");
        fail("UNAUTHORIZED", "Credencial de integración inválida.", 401);
      }
      const user = await deps.findUser(deps.config.userId);
      if (
        !user ||
        user.state !== 1 ||
        user.deletedAt ||
        user.isSystemAdmin ||
        !user.workflowOwner?.isActive ||
        user.workflowOwner.code !== "TESORERIA"
      )
        fail(
          "FORBIDDEN",
          "La identidad de servicio debe estar activa y pertenecer a TESORERIA.",
          403,
        );
      actors.set(req, {
        id: user.id,
        workflowOwnerId: user.workflowOwner.id,
        clientId: deps.config.clientId,
      });
      next();
    }),
  );
  const actor = (req: Request) => actors.get(req)!;
  const id = (req: Request) => z.string().uuid().parse(req.params.id);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxFileBytes, files: 1, fields: 0, parts: 1 },
    fileFilter: (_req, file, callback) => {
      if (file.mimetype !== "application/pdf")
        return callback(
          new IntegrationError(
            "INVALID_PDF",
            "Se requiere application/pdf.",
            400,
          ),
        );
      callback(null, true);
    },
  }).single("file");
  router.get(
    "/solicitudes",
    run(async (req, res) => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: z.string().uuid().optional(),
        })
        .strict()
        .parse(req.query);
      res.json(await deps.service.list(query.limit, query.cursor));
    }),
  );
  router.get(
    "/solicitudes/:id/plan",
    run(async (req, res) => {
      res.json(await deps.service.plan(id(req)));
    }),
  );
  router.post(
    "/solicitudes/:id/reserva",
    run(async (req, res) => {
      res.json(
        await deps.service.reserve(
          id(req),
          reserveSchema.parse(req.body),
          actor(req),
        ),
      );
    }),
  );
  router.get(
    "/reservas/:key",
    run(async (req, res) => {
      res.json(
        await deps.service.byKey(
          z.string().uuid().parse(req.params.key),
          actor(req),
        ),
      );
    }),
  );
  router.get(
    "/desembolsos/:id",
    run(async (req, res) => {
      res.json(await deps.service.get(id(req), actor(req)));
    }),
  );
  router.post(
    "/desembolsos/:id/revalidar",
    run(async (req, res) => {
      res.json(await deps.service.revalidate(id(req), actor(req)));
    }),
  );
  router.put(
    "/desembolsos/:id/pagos/:paymentKey",
    run(async (req, res) => {
      const paymentKey = z.string().max(120).parse(req.params.paymentKey);
      res.json(
        await deps.service.confirm(
          id(req),
          paymentKey,
          confirmationSchema.parse(req.body),
          actor(req),
        ),
      );
    }),
  );
  router.post(
    "/desembolsos/:id/comprobante",
    upload,
    run(async (req, res) => {
      if (!req.file) fail("MISSING_PDF", "Falta el archivo file.", 400);
      res.json(
        await deps.service.receipt(id(req), req.file!.buffer, actor(req)),
      );
    }),
  );
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({
          error: {
            code: "INVALID_REQUEST",
            message: "Formato de solicitud inválido.",
          },
        });
    } else if (error instanceof multer.MulterError) {
      res
        .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({
          error: {
            code: error.code,
            message: "Archivo fuera de los límites permitidos.",
          },
        });
    } else if (error instanceof IntegrationError) {
      res
        .status(error.statusCode)
        .json({ error: { code: error.code, message: error.message } });
    } else {
      // Workflow/domain failures preserve their HTTP status without leaking bank data or internals.
      const status =
        error instanceof Error &&
        "statusCode" in error &&
        typeof error.statusCode === "number"
          ? error.statusCode
          : 500;
      res
        .status(status)
        .json({
          error: {
            code: "INTEGRATION_FAILED",
            message:
              "No se pudo completar la operación. Consultar su estado antes de reintentar.",
          },
        });
    }
  };
  router.use(errors);
  return router;
}
