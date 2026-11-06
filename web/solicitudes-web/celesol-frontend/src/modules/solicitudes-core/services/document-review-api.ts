import { useQuery } from "@tanstack/react-query";
import { apiClient, fetchConSesion } from "@/shared/services/http/api-client";
import { ApiError } from "@/shared/services/http/api-error";

export type DocumentDecision = "approve" | "not_approve";
export type ReviewAttempt = {
  verificationId: string;
  completedAt: string | null;
  providerStatus: string | null;
  originalStatus: string | null;
  dashboardUrl: string | null;
  decision: DocumentDecision;
  reasons: string[];
  evidenceAvailable: boolean;
  checks: {
    code: string;
    label: string;
    passed: boolean;
    expected: string | null;
    actual: string | null;
    reason: string;
  }[];
  documents: {
    id: string;
    signer: string | null;
    signedAt: string | null;
    readAt: string | null;
  }[];
};
export type ReviewHumanDecision = {
  id: string;
  humanDecision: DocumentDecision;
  systemDecision: DocumentDecision;
  verificationId: string | null;
  attemptSystemDecision: DocumentDecision | null;
  disagreesWithSystem: boolean;
  overridesAttempt: boolean;
  reason: string;
  actorName: string;
  decidedAt: string;
  legajoAdjuntoId: string | null;
  providerCheckedAt: string | null;
  attemptsAtDecision: ReviewAttempt[];
  externalDocuments?: {
    name: string;
    contentType: string;
    size: number;
    sha256: string;
  }[];
};
export type DocumentReview = {
  id: string;
  evaluatedAt: string;
  policyVersion: string;
  evidenceType?: "external" | "metamap";
  sourceFingerprint: string;
  systemDecision: DocumentDecision;
  reasons: string[];
  selectedVerificationId: string | null;
  artifactError: string | null;
  legajoAdjuntoId: string | null;
  attempts: ReviewAttempt[];
  decisions: ReviewHumanDecision[];
};
export type DocumentReviewResponse = {
  enabled: boolean;
  canDecide: boolean;
  state?: string;
  currentReview: DocumentReview | null;
  history: DocumentReview[];
  signature?: SignatureSummary | null;
  analysisReady?: boolean;
};
export type SignatureSummary = {
  status: "waiting" | "to_review" | "requested_again" | "approved";
  completedAttempts: number;
  lastCompletedAt: string | null;
  approved: boolean;
  reason: string | null;
  link: string | null;
  cycle: string;
  decisionId: string | null;
  sourceFingerprint?: string;
  evidenceType?: "external" | "metamap" | null;
};
export type SignatureInboxItem = {
  solicitudId: string;
  nroSolicitud: string | null;
  prestamoId: string;
  socio: string;
  vendedor: string | null;
  monto: number | null;
  status: SignatureSummary["status"];
  completedAttempts: number;
  lastCompletedAt: string | null;
  analysisReady: boolean;
  reason: string | null;
};
export const signatureInboxKey = ["signature-inbox"] as const;
export function useSignatureInbox(
  status: SignatureSummary["status"] | "all",
  offset = 0,
) {
  return useQuery({
    queryKey: [...signatureInboxKey, status, offset],
    queryFn: () =>
      apiClient.get<{
        items: SignatureInboxItem[];
        total: number;
        offset: number;
        limit: number;
      }>(
        `/solicitudes/document-review/inbox?offset=${offset}&limit=50${status === "all" ? "" : `&status=${status}`}`,
      ),
    refetchInterval: 15000,
  });
}
export const documentReviewKey = (id: string) =>
  ["solicitudes-core", "document-review", id] as const;
export function useDocumentReview(id: string) {
  return useQuery({
    queryKey: documentReviewKey(id),
    enabled: Boolean(id),
    queryFn: () =>
      apiClient.get<DocumentReviewResponse>(
        `/solicitudes/${id}/document-review`,
      ),
    refetchInterval: (query) => (query.state.data?.enabled ? 15000 : false),
  });
}
export function requestNewSignature(
  id: string,
  reason: string,
  requestId: string,
) {
  return apiClient.post<DocumentReviewResponse>(
    `/solicitudes/${id}/document-review/request-signature`,
    { requestId, reason },
    300000,
  );
}
export function evaluateDocumentReview(id: string) {
  return apiClient.post<DocumentReviewResponse>(
    `/solicitudes/${id}/document-review/evaluate`,
    {},
    300000,
  );
}
export function decideDocumentReview(
  id: string,
  body: {
    reviewId: string;
    requestId: string;
    decision: DocumentDecision;
    verificationId: string | null;
    reason: string;
  },
) {
  return apiClient.post<DocumentReviewResponse>(
    `/solicitudes/${id}/document-review/decisions`,
    body,
    300000,
  );
}
export async function approveExternalLegajo(
  id: string,
  input: {
    requestId: string;
    sourceFingerprint: string;
    reason: string;
    files: File[];
  },
) {
  const body = new FormData();
  body.set("requestId", input.requestId);
  body.set("sourceFingerprint", input.sourceFingerprint);
  body.set("reason", input.reason);
  body.set("confirmed", "true");
  for (const file of input.files) body.append("files", file);
  const response = await fetchConSesion(
    `/solicitudes/${id}/document-review/external`,
    {
      method: "POST",
      body,
      signal: AbortSignal.timeout(300000),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(
      error?.error?.message ??
        error?.message ??
        "No se pudo guardar el legajo externo.",
      response.status,
    );
  }
  return (await response.json()) as DocumentReviewResponse;
}
export async function downloadDocumentLegajo(
  id: string,
  reviewId: string,
  decisionId?: string,
) {
  const url = `/solicitudes/${id}/document-review/${reviewId}/legajo${decisionId ? `?decisionId=${encodeURIComponent(decisionId)}` : ""}`;
  const response = await fetchConSesion(url, {
    method: "GET",
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new ApiError("No se pudo descargar el legajo.", response.status);
  const blob = await response.blob(),
    objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `legajo-digital-${reviewId}.pdf`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
}
