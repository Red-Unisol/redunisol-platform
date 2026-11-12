import type { DocumentReviewResponse } from "../src/modules/solicitudes-core/services/document-review-api";

export function externalLegajoFixture(
  approved: boolean,
): DocumentReviewResponse {
  const review = {
    id: "external-review",
    evidenceType: "external" as const,
    policyVersion: "external-legajo-v1",
    sourceFingerprint: "a".repeat(64),
    evaluatedAt: "2026-11-06T15:00:00Z",
    systemDecision: "not_approve" as const,
    reasons: ["Legajo externo: revisión humana de documentación adjunta."],
    selectedVerificationId: null,
    artifactError: null,
    legajoAdjuntoId: "external-legajo",
    attempts: [],
    decisions: [
      {
        id: "external-decision",
        humanDecision: "approve" as const,
        systemDecision: "not_approve" as const,
        verificationId: null,
        attemptSystemDecision: null,
        disagreesWithSystem: true,
        overridesAttempt: false,
        reason: "PDF exportado de MetaMap ante un problema de conexión.",
        actorName: "Revisor de ejemplo",
        decidedAt: "2026-11-06T15:00:00Z",
        legajoAdjuntoId: "external-legajo",
        providerCheckedAt: null,
        attemptsAtDecision: [],
        externalDocuments: [
          {
            name: "legajo-exportado.pdf",
            contentType: "application/pdf",
            size: 1024,
            sha256: "b".repeat(64),
          },
        ],
      },
    ],
  };
  return {
    enabled: true,
    canDecide: true,
    analysisReady: true,
    state: approved ? "Transferir" : "VerificarFirmaYDocumentacion",
    currentReview: approved ? review : null,
    history: approved ? [review] : [],
    signature: {
      status: approved ? "approved" : "waiting",
      completedAttempts: 0,
      lastCompletedAt: null,
      approved,
      reason: null,
      link: null,
      cycle: "demo-cycle",
      decisionId: approved ? "external-decision" : null,
      evidenceType: approved ? "external" : null,
      sourceFingerprint: "a".repeat(64),
    },
  };
}
