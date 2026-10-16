import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type SolicitudDocumentReview,
} from "@prisma/client";
import { actingHistoryFields } from "../auth/impersonation/context";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import type { AdjuntosObjectStorage } from "../solicitudes-core/adjuntos/domain/services/AdjuntosObjectStorage";
import {
  assess,
  decisionDisparity,
  digest,
  DocumentReviewError,
  providerFingerprint,
  REVIEW_POLICY_VERSION,
  REVIEW_STATE,
  type Assessment,
  type Decision,
  type ProviderCandidate,
  type ReviewSource,
} from "./domain";
import type { EvidenceGateway } from "./MetaMapGateway";
import type { HumanReport, LegajoBuilder } from "./LegajoPdf";

type Transition = (
  tx: Prisma.TransactionClient,
  solicitudId: string,
  user: AuthUser,
  decisionId: string,
  action: "transferir" | "devolver_a_liquidada",
  comment: string,
) => Promise<void>;
type Dependencies = {
  db: PrismaClient;
  gateway: EvidenceGateway;
  storage: AdjuntosObjectStorage;
  bucket: string;
  buildLegajo: LegajoBuilder;
  transition: Transition;
  maxPdfBytes: number;
  now?: () => Date;
};
const sourceInclude = {
  titular: true,
  estadoActual: { include: { owner: true } },
  estadoHistorial: {
    where: { toStateCodeSnapshot: REVIEW_STATE },
    orderBy: { changedAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.SolicitudInclude;
type SourceRow = Prisma.SolicitudGetPayload<{ include: typeof sourceInclude }>;
const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const assessmentDigest = (assessment: Assessment) =>
  digest({
    ...assessment,
    attempts: assessment.attempts.map((a) => ({
      ...a,
      documents: a.documents.map(({ url: _url, ...d }) => d),
    })),
  });

export function reviewSource(s: SourceRow): ReviewSource {
  const t = s.titular;
  return {
    solicitudId: s.id,
    nroSolicitud: s.nroSolicitud,
    prestamoId: s.legacyOid,
    cycleId: s.estadoHistorial[0]?.id ?? `${s.id}:${s.createdAt.toISOString()}`,
    line: s.lineaPrestamoDescripcion,
    mutual: s.lineaPrestamoCodigoMutual,
    name: [t?.apellidoDenominacion, t?.nombre].filter(Boolean).join(" "),
    dni: t?.nroDocumento ?? null,
    amount: s.montoAFinanciar?.toString() ?? null,
    installments: s.cuotas,
    installmentAmount: s.cuotaResultante,
    birthDate: t?.fechaNacimiento?.toISOString().slice(0, 10) ?? null,
    address:
      [t?.domicilioCalle, t?.nroPuerta, t?.localidad]
        .filter(Boolean)
        .join(" ") || null,
    phone: t?.celular ?? null,
    email: t?.email ?? null,
  };
}

export class DocumentReviewService {
  private inFlight = new Map<string, Promise<SolicitudDocumentReview>>();
  private now: () => Date;
  constructor(private deps: Dependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  private async source(
    id: string,
    db: PrismaClient | Prisma.TransactionClient = this.deps.db,
  ) {
    const row = await db.solicitud.findUnique({
      where: { id },
      include: sourceInclude,
    });
    if (!row)
      throw new DocumentReviewError("No se encontró la solicitud.", 404);
    return row;
  }
  private canDecide(row: SourceRow, user: AuthUser) {
    return (
      row.estadoActual.code === REVIEW_STATE &&
      (user.isSystemAdmin ||
        Boolean(
          user.workflowOwnerId &&
          row.estadoActual.ownerId === user.workflowOwnerId,
        ))
    );
  }
  private async discovered(source: ReviewSource) {
    if (!source.prestamoId)
      return {
        candidates: [] as ProviderCandidate[],
        error:
          "La solicitud no tiene un préstamo asociado para localizar las firmas.",
      };
    try {
      return {
        candidates: await this.deps.gateway.candidates(source.prestamoId),
        error: null,
      };
    } catch {
      return {
        candidates: [] as ProviderCandidate[],
        error:
          "No se pudieron consultar los intentos vigentes de MetaMap. Ante la duda, no aprobar.",
      };
    }
  }
  async view(id: string, user: AuthUser) {
    const row = await this.source(id);
    const fingerprint = digest(reviewSource(row));
    const records = await this.deps.db.solicitudDocumentReview.findMany({
      where: { solicitudId: id },
      orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
      take: 100,
      include: { decisions: { orderBy: { decidedAt: "desc" } } },
    });
    const publicRecords = records.map((r) => {
      const assessment = r.assessment as unknown as Assessment;
      return {
        id: r.id,
        policyVersion: r.policyVersion,
        evaluatedAt: r.evaluatedAt.toISOString(),
        sourceFingerprint: r.sourceFingerprint,
        source: r.sourceSnapshot,
        systemDecision: r.systemDecision,
        reasons: assessment.reasons,
        selectedVerificationId: r.selectedVerificationId,
        artifactError: r.artifactError,
        legajoAdjuntoId: r.legajoAdjuntoId,
        attempts: assessment.attempts.map((a) => ({
          ...a,
          documents: a.documents.map(({ url: _url, ...d }) => d),
        })),
        decisions: r.decisions.map((d) => ({
          id: d.id,
          humanDecision: d.humanDecision,
          systemDecision: d.systemDecision,
          verificationId: d.verificationId,
          attemptSystemDecision: d.attemptSystemDecision,
          disagreesWithSystem: d.disagreesWithSystem,
          overridesAttempt: d.overridesAttempt,
          reason: d.reason,
          actorName: d.actorName,
          decidedAt: d.decidedAt.toISOString(),
          legajoAdjuntoId: d.legajoAdjuntoId,
          providerCheckedAt:
            (d.actingAudit as Record<string, unknown> | null)
              ?.providerCheckedAt ?? null,
          attemptsAtDecision:
            (d.actingAudit as Record<string, unknown> | null)
              ?.attemptsAtDecision ?? [],
        })),
      };
    });
    return {
      enabled: true,
      canDecide: this.canDecide(row, user),
      state: row.estadoActual.code,
      currentReview:
        publicRecords.find((r) => r.sourceFingerprint === fingerprint) ?? null,
      history: publicRecords,
    };
  }
  async refresh(id: string, user: AuthUser) {
    const row = await this.source(id);
    if (!this.canDecide(row, user))
      throw new DocumentReviewError(
        "Solo el área responsable de la verificación puede actualizar esta revisión.",
        403,
      );
    await this.evaluate(id);
    return this.view(id, user);
  }
  evaluate(id: string): Promise<SolicitudDocumentReview> {
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const run = this.evaluateOnce(id).finally(() => {
      this.inFlight.delete(id);
    });
    this.inFlight.set(id, run);
    return run;
  }
  private async evaluateOnce(id: string) {
    const row = await this.source(id);
    if (row.estadoActual.code !== REVIEW_STATE)
      throw new DocumentReviewError(
        "La solicitud ya no está en verificación de firma y documentación.",
      );
    const source = reviewSource(row),
      sourceFingerprint = digest(source);
    const { candidates, error } = await this.discovered(source);
    const providerHash = providerFingerprint(candidates),
      assessment = assess(source, candidates, error);
    const previous = await this.deps.db.solicitudDocumentReview.findFirst({
      where: { solicitudId: id },
      orderBy: { evaluatedAt: "desc" },
    });
    const unchanged =
      previous?.sourceFingerprint === sourceFingerprint &&
      previous.providerFingerprint === providerHash &&
      previous.policyVersion === REVIEW_POLICY_VERSION &&
      assessmentDigest(previous.assessment as unknown as Assessment) ===
        assessmentDigest(assessment);
    if (unchanged && !previous.artifactError && previous.legajoAdjuntoId)
      return previous;
    const reviewId = randomUUID(),
      evaluatedAt = this.now();
    const attempt =
      assessment.attempts.find(
        (a) => a.verificationId === assessment.selectedVerificationId,
      ) ?? null;
    const resource =
      candidates.find((c) => c.verificationId === attempt?.verificationId)
        ?.resource ?? null;
    const basePath = `solicitudes/${id}/revision-documental/${reviewId}`;
    const evidencePath = `${basePath}/evidencia.json`;
    const pdfPath = `${basePath}/legajo.pdf`,
      adjuntoId = randomUUID();
    let artifactError: string | null = null,
      bytes: Buffer | null = null,
      evidenceSaved = false,
      pdfSaved = false;
    try {
      await this.deps.storage.uploadObject({
        bucket: this.deps.bucket,
        key: evidencePath,
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify({
            source,
            candidates,
            assessment,
            evaluatedAt,
            policyVersion: REVIEW_POLICY_VERSION,
          }),
        ),
      });
      evidenceSaved = true;
      bytes = await this.deps.buildLegajo({
        reviewId,
        evaluatedAt: evaluatedAt.toISOString(),
        policyVersion: REVIEW_POLICY_VERSION,
        source,
        assessment,
        attempt,
        resource,
      });
      if (bytes.length > this.deps.maxPdfBytes)
        throw new Error("Legajo exceeds attachment size");
      await this.deps.storage.uploadObject({
        bucket: this.deps.bucket,
        key: pdfPath,
        contentType: "application/pdf",
        body: bytes,
      });
      pdfSaved = true;
    } catch {
      artifactError =
        "No se pudo guardar el legajo completo y su evidencia. Actualizá la revisión antes de decidir.";
    }
    const evaluationKey = digest({
      previousId: previous?.id ?? null,
      sourceFingerprint,
      providerHash,
      assessment,
      policy: REVIEW_POLICY_VERSION,
      artifactReady: !artifactError,
    });
    const cleanup = async () => {
      if (pdfSaved)
        await this.deps.storage
          .deleteObject({ bucket: this.deps.bucket, key: pdfPath })
          .catch(() => undefined);
      if (evidenceSaved)
        await this.deps.storage
          .deleteObject({ bucket: this.deps.bucket, key: evidencePath })
          .catch(() => undefined);
    };
    if (unchanged && artifactError && previous.artifactError) {
      await cleanup();
      return previous;
    }
    try {
      const review = await this.deps.db.$transaction(async (tx) => {
        await this.lockSource(tx, id);
        const current = await this.source(id, tx);
        if (
          current.estadoActual.code !== REVIEW_STATE ||
          digest(reviewSource(current)) !== sourceFingerprint
        ) {
          throw new DocumentReviewError(
            "Los datos o el estado cambiaron durante la revisión. Actualizá la evaluación.",
          );
        }
        if (pdfSaved && bytes)
          await this.attach(tx, {
            id: adjuntoId,
            solicitudId: id,
            path: pdfPath,
            bytes,
            human: null,
            verificationId: attempt?.verificationId ?? null,
            title: "Legajo digital - propuesta del sistema",
          });
        return tx.solicitudDocumentReview.create({
          data: {
            id: reviewId,
            solicitudId: id,
            evaluationKey,
            sourceFingerprint,
            providerFingerprint: providerHash,
            policyVersion: REVIEW_POLICY_VERSION,
            sourceSnapshot: json(source),
            assessment: json(assessment),
            systemDecision: assessment.decision,
            selectedVerificationId: assessment.selectedVerificationId,
            evaluatedAt,
            artifactError,
            evidencePath: evidenceSaved ? evidencePath : null,
            legajoAdjuntoId: pdfSaved ? adjuntoId : null,
          },
        });
      });
      return review;
    } catch (e) {
      await cleanup();
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        const same = await this.deps.db.solicitudDocumentReview.findUnique({
          where: { evaluationKey },
        });
        if (same) return same;
      }
      throw e;
    }
  }

  private async lockSource(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM solicitudes WHERE id=${id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT solicitud_id FROM solicitud_titulares WHERE solicitud_id=${id}::uuid FOR UPDATE`;
  }
  private async attach(
    tx: Prisma.TransactionClient,
    input: {
      id: string;
      solicitudId: string;
      path: string;
      bytes: Buffer;
      human: AuthUser | null;
      verificationId: string | null;
      title: string;
    },
  ) {
    return tx.solicitudAdjunto.create({
      data: {
        id: input.id,
        solicitudId: input.solicitudId,
        archivoNombre: `legajo-digital-${input.id}.pdf`,
        archivoPath: input.path,
        archivoMimeType: "application/pdf",
        archivoSizeBytes: BigInt(input.bytes.length),
        storageBucket: this.deps.bucket,
        tipoAdjunto: "Legajo Digital",
        estadoAdjunto: "Cargado",
        descripcion: input.title,
        adicional: input.verificationId,
        uploadedBy: input.human?.id ?? null,
        uploadedAt: this.now(),
        comentario:
          "Legajo generado por BEEX. Las decisiones y la evidencia se conservan en el historial de revisión.",
      },
    });
  }

  async decide(
    id: string,
    user: AuthUser,
    input: {
      reviewId: string;
      requestId: string;
      decision: Decision;
      verificationId: string | null;
      reason: string;
    },
  ): Promise<Awaited<ReturnType<DocumentReviewService["view"]>>> {
    const duplicate = await this.deps.db.solicitudDocumentDecision.findUnique({
      where: { requestId: input.requestId },
      include: { review: true },
    });
    if (duplicate) {
      if (
        duplicate.review.solicitudId !== id ||
        duplicate.decidedBy !== user.id ||
        duplicate.reviewId !== input.reviewId ||
        duplicate.humanDecision !== input.decision ||
        duplicate.verificationId !== input.verificationId ||
        duplicate.reason !== input.reason.trim()
      ) {
        throw new DocumentReviewError(
          "La clave de esta decisión ya fue utilizada con otros datos.",
        );
      }
      return this.view(id, user);
    }
    const row = await this.source(id);
    if (!this.canDecide(row, user))
      throw new DocumentReviewError(
        "No tenés permisos para decidir esta verificación.",
        403,
      );
    const review = await this.deps.db.solicitudDocumentReview.findFirst({
      where: { id: input.reviewId, solicitudId: id },
    });
    if (!review)
      throw new DocumentReviewError(
        "No se encontró la revisión de esta solicitud.",
        404,
      );
    const source = reviewSource(row),
      fingerprint = digest(source);
    if (review.sourceFingerprint !== fingerprint)
      throw new DocumentReviewError(
        "La solicitud cambió. Actualizá la revisión antes de decidir.",
      );
    const assessment = review.assessment as unknown as Assessment;
    const attempt =
      assessment.attempts.find(
        (a) => a.verificationId === input.verificationId,
      ) ?? null;
    if (input.verificationId && !attempt)
      throw new DocumentReviewError(
        "El intento elegido no pertenece a esta evaluación.",
        400,
      );
    const disparity = decisionDisparity(
      assessment.decision,
      input.decision,
      attempt,
    );
    const reason = input.reason.trim();
    if (
      (input.decision === "not_approve" ||
        disparity.disagreesWithSystem ||
        disparity.overridesAttempt) &&
      !reason
    ) {
      throw new DocumentReviewError(
        "Indicá el motivo de la desaprobación o de la diferencia con el sistema.",
        400,
      );
    }
    if (
      input.decision === "approve" &&
      (!attempt?.evidenceAvailable ||
        review.artifactError ||
        !review.evidencePath ||
        !review.legajoAdjuntoId)
    ) {
      throw new DocumentReviewError(
        "Para aprobar se requiere un intento firmado con evidencia y legajo completos. Actualizá la revisión.",
      );
    }
    let candidates: ProviderCandidate[] = [];
    let decisionAssessment = assessment;
    const validateFresh = (fresh: {
      candidates: ProviderCandidate[];
      error: string | null;
    }) => {
      const checked = assess(source, fresh.candidates, fresh.error);
      const selected = checked.attempts.find(
        (a) => a.verificationId === attempt?.verificationId,
      );
      return (
        !fresh.error &&
        checked.decision === assessment.decision &&
        selected?.resourceFingerprint === attempt?.resourceFingerprint
      );
    };
    if (input.decision === "approve") {
      const fresh = await this.discovered(source);
      candidates = fresh.candidates;
      if (!validateFresh(fresh)) {
        await this.evaluate(id);
        throw new DocumentReviewError(
          "MetaMap cambió o no se pudo comprobar su estado vigente. Revisá la nueva evaluación antes de aprobar.",
        );
      }
      decisionAssessment = assess(source, candidates);
    }
    const decisionId = randomUUID(),
      decidedAt = this.now(),
      actorName =
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.legacyUser;
    const human: HumanReport = {
      id: decisionId,
      decision: input.decision,
      reason,
      actor: actorName,
      decidedAt: decidedAt.toISOString(),
      ...disparity,
    };
    const path = `solicitudes/${id}/revision-documental/${review.id}/decisiones/${decisionId}.pdf`,
      adjuntoId = randomUUID();
    let bytes: Buffer | null = null,
      saved = false;
    if (input.decision === "approve") {
      const resource =
        candidates.find((c) => c.verificationId === attempt?.verificationId)
          ?.resource ?? null;
      try {
        bytes = await this.deps.buildLegajo({
          reviewId: review.id,
          policyVersion: review.policyVersion,
          evaluatedAt: review.evaluatedAt.toISOString(),
          source,
          assessment: decisionAssessment,
          attempt,
          resource,
          human,
        });
        if (bytes.length > this.deps.maxPdfBytes)
          throw new Error("Legajo exceeds attachment size");
        await this.deps.storage.uploadObject({
          bucket: this.deps.bucket,
          key: path,
          contentType: "application/pdf",
          body: bytes,
        });
        saved = true;
      } catch {
        throw new DocumentReviewError(
          "No se pudo guardar el legajo con la decisión humana. La solicitud no avanzó.",
          503,
        );
      }
      const confirmed = await this.discovered(source);
      if (!validateFresh(confirmed)) {
        await this.deps.storage
          .deleteObject({ bucket: this.deps.bucket, key: path })
          .catch(() => undefined);
        throw new DocumentReviewError(
          "MetaMap cambió mientras se generaba el legajo. Actualizá la revisión antes de aprobar.",
        );
      }
      candidates = confirmed.candidates;
      decisionAssessment = assess(source, candidates);
    }
    if (input.decision === "not_approve") {
      // A technical failure must not prevent a human from returning a case
      // for correction. The structured decision is still committed atomically.
      try {
        let archivedLegajo: Buffer | undefined;
        if (review.legajoAdjuntoId) {
          const stream = await this.legajo(id, review.id);
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of stream as AsyncIterable<Buffer>) {
            size += chunk.length;
            if (size > this.deps.maxPdfBytes)
              throw new Error("Archived legajo too large");
            chunks.push(chunk);
          }
          archivedLegajo = Buffer.concat(chunks);
        }
        bytes = await this.deps.buildLegajo({
          reviewId: review.id,
          policyVersion: review.policyVersion,
          evaluatedAt: review.evaluatedAt.toISOString(),
          source,
          assessment,
          attempt,
          resource: null,
          human,
          includeOriginals: false,
          archivedLegajo,
        });
        if (bytes.length > this.deps.maxPdfBytes)
          throw new Error("Legajo exceeds attachment size");
        await this.deps.storage.uploadObject({
          bucket: this.deps.bucket,
          key: path,
          contentType: "application/pdf",
          body: bytes,
        });
        saved = true;
      } catch {
        bytes = null;
      }
    }
    const decisionEvidencePath = `solicitudes/${id}/revision-documental/${review.id}/decisiones/${decisionId}.json`;
    let decisionEvidenceSaved = false;
    if (input.decision === "approve") {
      try {
        await this.deps.storage.uploadObject({
          bucket: this.deps.bucket,
          key: decisionEvidencePath,
          contentType: "application/json",
          body: Buffer.from(
            JSON.stringify({
              source,
              candidates,
              assessment: decisionAssessment,
              human,
              checkedAt: this.now().toISOString(),
            }),
          ),
        });
        decisionEvidenceSaved = true;
      } catch {
        if (saved)
          await this.deps.storage
            .deleteObject({ bucket: this.deps.bucket, key: path })
            .catch(() => undefined);
        throw new DocumentReviewError(
          "No se pudo guardar la evidencia de la decisión humana. La solicitud no avanzó.",
          503,
        );
      }
    }
    let replayed = false;
    try {
      await this.deps.db.$transaction(
        async (tx) => {
          await this.lockSource(tx, id);
          const replay = await tx.solicitudDocumentDecision.findUnique({
            where: { requestId: input.requestId },
          });
          if (replay) {
            if (
              replay.reviewId !== review.id ||
              replay.decidedBy !== user.id ||
              replay.humanDecision !== input.decision ||
              replay.verificationId !== input.verificationId ||
              replay.reason !== reason
            )
              throw new DocumentReviewError(
                "La clave de esta decisión ya fue utilizada con otros datos.",
              );
            replayed = true;
            return;
          }
          const current = await this.source(id, tx);
          if (
            !this.canDecide(current, user) ||
            digest(reviewSource(current)) !== fingerprint
          ) {
            throw new DocumentReviewError(
              "La solicitud cambió mientras se decidía. No se registró el avance.",
            );
          }
          if (saved && bytes)
            await this.attach(tx, {
              id: adjuntoId,
              solicitudId: id,
              path,
              bytes,
              human: user,
              verificationId: attempt?.verificationId ?? null,
              title: "Legajo digital - decisión humana",
            });
          await tx.solicitudDocumentDecision.create({
            data: {
              id: decisionId,
              requestId: input.requestId,
              reviewId: review.id,
              humanDecision: input.decision,
              systemDecision: assessment.decision,
              verificationId: input.verificationId,
              attemptSystemDecision: attempt?.decision ?? null,
              ...disparity,
              reason,
              decidedBy: user.id,
              actorName,
              actingAudit: json({
                ...actingHistoryFields(),
                providerCheckedAt:
                  input.decision === "approve"
                    ? this.now().toISOString()
                    : null,
                providerFingerprintAtDecision:
                  input.decision === "approve"
                    ? providerFingerprint(candidates)
                    : null,
                decisionEvidencePath: decisionEvidenceSaved
                  ? decisionEvidencePath
                  : null,
                attemptsAtDecision: decisionAssessment.attempts.map(
                  ({ resourceFingerprint: _fingerprint, documents, ...a }) => ({
                    ...a,
                    documents: documents.map(({ url: _url, ...d }) => d),
                  }),
                ),
              }),
              decidedAt,
              legajoAdjuntoId: saved ? adjuntoId : null,
            },
          });
          await this.deps.transition(
            tx,
            id,
            user,
            decisionId,
            input.decision === "approve"
              ? "transferir"
              : "devolver_a_liquidada",
            `Revisión documental ${decisionId}. Decisión humana: ${input.decision === "approve" ? "aprobada" : "no aprobada"}. Propuesta del sistema: ${assessment.decision}. ${reason}`,
          );
        },
        { timeout: 20000 },
      );
    } catch (e) {
      if (saved)
        await this.deps.storage
          .deleteObject({ bucket: this.deps.bucket, key: path })
          .catch(() => undefined);
      if (decisionEvidenceSaved)
        await this.deps.storage
          .deleteObject({ bucket: this.deps.bucket, key: decisionEvidencePath })
          .catch(() => undefined);
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        return this.decide(id, user, input);
      throw e;
    }
    if (replayed && saved)
      await this.deps.storage
        .deleteObject({ bucket: this.deps.bucket, key: path })
        .catch(() => undefined);
    if (replayed && decisionEvidenceSaved)
      await this.deps.storage
        .deleteObject({ bucket: this.deps.bucket, key: decisionEvidencePath })
        .catch(() => undefined);
    return this.view(id, user);
  }

  async legajo(id: string, reviewId: string, decisionId?: string) {
    const review = await this.deps.db.solicitudDocumentReview.findFirst({
      where: { id: reviewId, solicitudId: id },
    });
    if (!review)
      throw new DocumentReviewError(
        "No se encontró el legajo de esta solicitud.",
        404,
      );
    const decision = decisionId
      ? await this.deps.db.solicitudDocumentDecision.findFirst({
          where: { id: decisionId, reviewId },
        })
      : null;
    if (decisionId && !decision)
      throw new DocumentReviewError(
        "No se encontró la decisión de este legajo.",
        404,
      );
    const adjuntoId = decision
      ? decision.legajoAdjuntoId
      : review.legajoAdjuntoId;
    const adjunto = await this.deps.db.solicitudAdjunto.findFirst({
      where: {
        id: adjuntoId ?? "00000000-0000-0000-0000-000000000000",
        solicitudId: id,
        deletedAt: null,
      },
    });
    if (!adjunto?.archivoPath || !adjunto.storageBucket)
      throw new DocumentReviewError("El legajo aún no está disponible.", 404);
    return this.deps.storage.getObjectStream({
      bucket: adjunto.storageBucket,
      key: adjunto.archivoPath,
    });
  }

  async poll(limit = 5) {
    const now = this.now();
    const pending = await this.deps.db.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM solicitudes s
      JOIN workflow_states state ON state.id=s.estado_actual_id
      LEFT JOIN solicitud_document_review_jobs job ON job.solicitud_id=s.id
      WHERE state.code=${REVIEW_STATE}
        AND (job.next_check_at IS NULL OR job.next_check_at<=${now})
        AND (job.lease_until IS NULL OR job.lease_until<${now})
      ORDER BY COALESCE(job.next_check_at, 'epoch'::timestamp), s.updated_at, s.id
      LIMIT ${limit}`;
    for (const s of pending) {
      await this.deps.db.solicitudDocumentReviewJob.upsert({
        where: { solicitudId: s.id },
        update: {},
        create: { solicitudId: s.id, nextCheckAt: now },
      });
      const token = randomUUID();
      const leased = await this.deps.db.solicitudDocumentReviewJob.updateMany({
        where: {
          solicitudId: s.id,
          nextCheckAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        data: {
          leaseToken: token,
          leaseUntil: new Date(now.getTime() + 10 * 60000),
        },
      });
      if (!leased.count) continue;
      try {
        await this.evaluate(s.id);
      } catch {
        console.warn("No se completó una revisión documental; se reintentará.");
      } finally {
        await this.deps.db.solicitudDocumentReviewJob.updateMany({
          where: { solicitudId: s.id, leaseToken: token },
          data: {
            leaseToken: null,
            leaseUntil: null,
            nextCheckAt: new Date(this.now().getTime() + 60000),
          },
        });
      }
    }
  }
}
