import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import type { GetCurrentUserUseCase } from "../auth/application/use-cases/GetCurrentUser.use-case";
import { ACCESS_TOKEN_COOKIE } from "../auth/presentation/AuthCookies";
import { MinioAdjuntosObjectStorage } from "../solicitudes-core/adjuntos/infrastructure/services/MinioAdjuntosObjectStorage";
import { DocumentReviewService } from "./DocumentReviewService";
import { DocumentReviewError } from "./domain";
import { isLegajosUser } from "./signature-workflow";
import { MetaMapGateway } from "./MetaMapGateway";
import { createLegajoBuilder } from "./LegajoPdf";
import { createDocumentReviewWorkflow } from "./workflow";import { notifySignatureEvent } from "../notifications/SignatureNotifications";
import { assertWorkflowFinancialReady, assertSignatureLinkFinancialReady } from "../solicitudes-core/infrastructure/services/WorkflowFinancialGuard";
import { administrativeSource } from "../solicitudes-core/infrastructure/services/AdministrativeCorrectionService";
import { isAnalysisReady } from "./signature-workflow";

let service: DocumentReviewService | null = null;
function getService() {
  if (!env.DOCUMENT_REVIEW_ENABLED)
    throw new DocumentReviewError(
      "La revisión documental no está configurada.",
      503,
    );
  if (!service) {
    const gateway = new MetaMapGateway({
      serverBaseUrl: env.DOCUMENT_REVIEW_SERVER_BASE_URL,
      serverClientId: env.DOCUMENT_REVIEW_SERVER_CLIENT_ID,
      serverClientSecret: env.DOCUMENT_REVIEW_SERVER_CLIENT_SECRET,
      clientId: env.DOCUMENT_REVIEW_METAMAP_CLIENT_ID,
      clientSecret: env.DOCUMENT_REVIEW_METAMAP_CLIENT_SECRET,
      timeoutMs: env.DOCUMENT_REVIEW_TIMEOUT_MS,
    });
    service = new DocumentReviewService({
      db: prisma,
      gateway,
      storage: new MinioAdjuntosObjectStorage({
        accessKey: env.MINIO_ACCESS_KEY,
        secretKey: env.MINIO_SECRET_KEY,
        endPoint: env.MINIO_ENDPOINT,
        port: env.MINIO_PORT,
        useSSL: env.MINIO_USE_SSL,
        region: env.MINIO_REGION,
      }),
      bucket: env.MINIO_BUCKET_SOLICITUDES,
      maxPdfBytes: env.DOCUMENT_REVIEW_MAX_PDF_BYTES,
      buildLegajo: createLegajoBuilder(gateway),
      transition: createDocumentReviewWorkflow(prisma),      onSignatureEvent: notifySignatureEvent,
      financialPreflight: async (id, user) => {
        const proof = await assertSignatureLinkFinancialReady(prisma, id);
        if (isAnalysisReady(await administrativeSource(prisma, id)))
          await assertWorkflowFinancialReady(prisma, id, user.id);
        return proof;
      },
    });
  }
  return service;
}
const decisionSchema = z
  .object({
    reviewId: z.uuid(),
    requestId: z.uuid(),
    decision: z.enum(["approve", "not_approve"]),
    verificationId: z
      .string()
      .regex(/^[a-zA-Z0-9-]{1,120}$/)
      .nullable(),
    reason: z.string().trim().max(4000),
  })
  .strict();

export function createDocumentReviewRouter(auth: GetCurrentUserUseCase) {
  const router = Router();
  router.use(["/:id/document-review", "/document-review/inbox"], async (req, res, next) => {
    try {
      res.locals.documentReviewUser = await auth.execute(req.cookies?.[ACCESS_TOKEN_COOKIE]);
      next();
    } catch (e) { next(e); }
  });
  router.get("/document-review/inbox", async (req, res, next) => {
    try {
      const query = z.object({
        status: z.enum(["waiting", "to_review", "requested_again", "approved"]).optional(),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }).parse(req.query);
      res.setHeader("Cache-Control", "no-store");
      res.json(await getService().inbox(res.locals.documentReviewUser, query.status, query.offset, query.limit));
    } catch (e) { next(e instanceof z.ZodError ? new DocumentReviewError("Filtro inválido.", 400) : e); }
  });
  router.get("/:id/document-review", async (req, res, next) => {
    try {
      const id = z.uuid().parse(req.params.id);
      res.setHeader("Cache-Control", "no-store");
      res.json(
        env.DOCUMENT_REVIEW_ENABLED
          ? await getService().view(id, res.locals.documentReviewUser)
          : {
              enabled: false,
              canDecide: false,
              currentReview: null,
              history: [],
              signature: null,
              analysisReady: false,
            },
      );
    } catch (e) {
      next(
        e instanceof z.ZodError
          ? new DocumentReviewError("Solicitud inválida.", 400)
          : e,
      );
    }
  });
  router.post("/:id/document-review/evaluate", async (req, res, next) => {
    try {
      const id = z.uuid().parse(req.params.id);
      res.setHeader("Cache-Control", "no-store");
      res.json(await getService().refresh(id, res.locals.documentReviewUser));
    } catch (e) {
      next(
        e instanceof z.ZodError
          ? new DocumentReviewError("Solicitud inválida.", 400)
          : e,
      );
    }
  });
  router.post("/:id/document-review/request-signature", async (req, res, next) => {
    try {
      const id = z.uuid().parse(req.params.id);
      const input = z.object({ requestId: z.uuid(), reason: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
      res.setHeader("Cache-Control", "no-store");
      res.json(await getService().requestSignature(id, res.locals.documentReviewUser, input));
    } catch (e) { next(e instanceof z.ZodError ? new DocumentReviewError("Indicá el motivo de la nueva firma.", 400) : e); }
  });
  router.post("/:id/document-review/decisions", async (req, res, next) => {
    try {
      const id = z.uuid().parse(req.params.id),
        input = decisionSchema.parse(req.body);
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await getService().decide(id, res.locals.documentReviewUser, input),
      );
    } catch (e) {
      next(
        e instanceof z.ZodError
          ? new DocumentReviewError(
              "Los datos de la decisión son inválidos.",
              400,
            )
          : e,
      );
    }
  });
  router.get(
    "/:id/document-review/:reviewId/legajo",
    async (req, res, next) => {
      try {
        if (!isLegajosUser(res.locals.documentReviewUser)) throw new DocumentReviewError("Solo Legajos Digitales puede descargar esta evidencia.", 403);
        const id = z.uuid().parse(req.params.id),
          reviewId = z.uuid().parse(req.params.reviewId);
        const decisionId =
          req.query.decisionId === undefined
            ? undefined
            : z.uuid().parse(req.query.decisionId);
        const stream = await getService().legajo(id, reviewId, decisionId);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="legajo-digital-${reviewId}.pdf"`,
        );
        stream.on("error", next);
        stream.pipe(res);
      } catch (e) {
        next(
          e instanceof z.ZodError
            ? new DocumentReviewError("Legajo inválido.", 400)
            : e,
        );
      }
    },
  );
  return router;
}

export function startDocumentReviewWorker() {
  if (!env.DOCUMENT_REVIEW_ENABLED) return async () => undefined;
  let stopped = false,
    running: Promise<void> | null = null;
  const tick = () => {
    if (stopped || running) return;
    running = getService()
      .poll()
      .catch(() => {
        console.warn(
          "La revisión documental no pudo consultar sus pendientes; se reintentará.",
        );
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, 15000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
