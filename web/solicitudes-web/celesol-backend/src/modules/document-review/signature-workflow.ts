import { Prisma, type PrismaClient, type SolicitudDocumentReview, type SolicitudDocumentDecision } from "@prisma/client";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import { digest, hasMatchingSignedOperation, type Assessment, type ProviderCandidate, type ReviewSource } from "./domain";

export const SIGNATURE_OWNER = "LEGAJOS_DIGITALES";
export const signatureSourceInclude = {
  titular: true,
  desembolso: { select: { id: true } },
  pagoExterno: { select: { id: true } },
  estadoActual: { include: { owner: true } },
} satisfies Prisma.SolicitudInclude;
export type SignatureSourceRow = Prisma.SolicitudGetPayload<{ include: typeof signatureSourceInclude }>;
export type SignatureDatabase = PrismaClient | Prisma.TransactionClient;
export type SignatureStatus = "waiting" | "to_review" | "requested_again" | "approved";
export type SignatureSummary = {
  status: SignatureStatus;
  completedAttempts: number;
  lastCompletedAt: string | null;
  approved: boolean;
  reason: string | null;
  link: string | null;
  cycle: string;
  decisionId: string | null;
  sourceFingerprint: string;
  requestedAgain: boolean;
};

export function isLegajosUser(user: AuthUser) {
  return user.isSystemAdmin || user.workflowOwner?.code === SIGNATURE_OWNER;
}

export function isSignatureOpen(row: SignatureSourceRow) {
  return Boolean(row.legacyOid && !row.archivedAt && !row.estadoActual.isTerminal);
}

export function canManageSignature(row: SignatureSourceRow) {
  return isSignatureOpen(row) && !row.desembolso && !row.pagoExterno;
}

export function isAnalysisReady(row: Pick<SignatureSourceRow, "analisisFinalizadoAt" | "estadoActual">) {
  // Existing Liquidada/verification cases already passed the analysis handoff.
  return Boolean(row.analisisFinalizadoAt || ["Liquidada", "VerificarFirmaYDocumentacion", "Transferir"].includes(row.estadoActual.code));
}

export function reviewSource(s: SignatureSourceRow): ReviewSource {
  const t = s.titular;
  return {
    solicitudId: s.id,
    nroSolicitud: s.nroSolicitud,
    prestamoId: s.legacyOid,
    cycleId: s.signatureCycleId ?? `${s.legacyOid ?? s.id}:initial`,
    ...(s.signatureRequestedAt ? { signatureRequestedAt: s.signatureRequestedAt.toISOString() } : {}),
    line: s.lineaPrestamoDescripcion,
    mutual: s.lineaPrestamoCodigoMutual,
    name: [t?.apellidoDenominacion, t?.nombre].filter(Boolean).join(" "),
    dni: t?.nroDocumento ?? null,
    amount: s.montoAFinanciar?.toString() ?? null,
    installments: s.cuotas,
    installmentAmount: s.cuotaResultante,
    birthDate: t?.fechaNacimiento?.toISOString().slice(0, 10) ?? null,
    address: [t?.domicilioCalle, t?.nroPuerta, t?.localidad].filter(Boolean).join(" ") || null,
    phone: t?.celular ?? null,
    email: t?.email ?? null,
  };
}

export function eligibleSignatureCandidates(row: SignatureSourceRow, candidates: ProviderCandidate[]) {
  const excluded = new Set(Array.isArray(row.signatureExcludedVerificationIds) ? row.signatureExcludedVerificationIds.filter((v): v is string => typeof v === "string") : []);
  return candidates.filter(c => !excluded.has(c.verificationId) && (!row.signatureRequestedAt || (c.completedAt !== null && Date.parse(c.completedAt) >= row.signatureRequestedAt.getTime())));
}

export function completedSignatureAttempts(assessment: Assessment | null) {
  return (assessment?.attempts ?? []).filter(a => a.completedAt !== null && Number.isFinite(Date.parse(a.completedAt)));
}

type DecisionWithReview = SolicitudDocumentDecision & { review: SolicitudDocumentReview };

export function signatureSummary(row: SignatureSourceRow, review: SolicitudDocumentReview | null, decision: DecisionWithReview | null): SignatureSummary {
  const source = reviewSource(row), sourceFingerprint = digest(source);
  const assessment = review?.sourceFingerprint === sourceFingerprint ? review.assessment as unknown as Assessment : null;
  const completed = completedSignatureAttempts(assessment);
  const selectedNow = assessment?.attempts.find(a => a.verificationId === decision?.verificationId);
  const selectedAtApproval = (decision?.review.assessment as unknown as Assessment | undefined)?.attempts.find(a => a.verificationId === decision?.verificationId);
  const approved = Boolean(row.legacyOid && decision?.review.sourceFingerprint === sourceFingerprint && review?.sourceFingerprint === sourceFingerprint && decision?.humanDecision === "approve" && decision.legajoAdjuntoId && selectedNow?.evidenceAvailable && selectedNow.completedAt && Number.isFinite(Date.parse(selectedNow.completedAt)) && hasMatchingSignedOperation(selectedNow, { requireCycle: Boolean(row.signatureRequestedAt) }) && selectedNow.resourceFingerprint === selectedAtApproval?.resourceFingerprint);
  const requestedAgain = Boolean(row.signatureRequestedAt && !approved);
  return {
    status: approved ? "approved" : completed.length ? "to_review" : requestedAgain ? "requested_again" : "waiting",
    completedAttempts: completed.length,
    lastCompletedAt: completed.map(a => a.completedAt!).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
    approved,
    reason: requestedAgain ? row.signatureRequestReason : null,
    link: canManageSignature(row) ? row.linkFirmaDigital : null,
    cycle: source.cycleId,
    decisionId: approved ? decision!.id : null,
    sourceFingerprint,
    requestedAgain,
  };
}

export async function getSignatureApprovals(db: SignatureDatabase, rows: SignatureSourceRow[]) {
  const result = new Map<string, SignatureSummary>();
  // Bounded OR batches keep the inbox from issuing a query per row.
  for (let offset = 0; offset < rows.length; offset += 200) {
    const batch = rows.slice(offset, offset + 200);
    const matches = batch.map(row => ({ solicitudId: row.id, sourceFingerprint: digest(reviewSource(row)) }));
    const [reviews, decisions] = await Promise.all([
      db.solicitudDocumentReview.findMany({ where: { OR: matches }, orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }], distinct: ["solicitudId"] }),
      db.solicitudDocumentDecision.findMany({ where: { review: { OR: matches } }, orderBy: [{ decidedAt: "desc" }, { id: "desc" }], include: { review: true } }),
    ]);
    const byReview = new Map(reviews.map(review => [review.solicitudId, review]));
    const byDecision = new Map<string, DecisionWithReview>();
    for (const decision of decisions) if (!byDecision.has(decision.review.solicitudId)) byDecision.set(decision.review.solicitudId, decision);
    for (const row of batch) result.set(row.id, signatureSummary(row, byReview.get(row.id) ?? null, byDecision.get(row.id) ?? null));
  }
  return result;
}

export async function getSignatureApproval(db: SignatureDatabase, solicitudId: string): Promise<SignatureSummary> {
  const row = await db.solicitud.findUnique({ where: { id: solicitudId }, include: signatureSourceInclude });
  if (!row) throw new Error("No se encontró la solicitud.");
  return (await getSignatureApprovals(db, [row])).get(solicitudId)!;
}
