import type { LoginResponse } from "../src/modules/auth/services/auth-api";
import type {
  DocumentReview,
  DocumentReviewResponse,
  ReviewAttempt,
} from "../src/modules/solicitudes-core/services/document-review-api";
import { SAMPLE_REQUEST } from "./header-sample.ts";

/** Fictional identifiers only; never replace these with customer records. */
export const HEADER_SAMPLE = {
  id: SAMPLE_REQUEST.id,
  number: SAMPLE_REQUEST.number,
  name: SAMPLE_REQUEST.name,
  document: "00000001",
  cuit: "20000000001",
  convenio: "CONVENIO DE EJEMPLO · HABERES",
  member: SAMPLE_REQUEST.member,
  loanId: "999001",
  state: "Pagada",
  titular: {
    nombre: "MARÍA",
    apellidoDenominacion: "EJEMPLO",
    tipoDocumento: "DNI",
    nroDocumento: "00000001",
    cuit: "20000000001",
  },
} as const;

export const HEADER_SESSION_FIXTURE: LoginResponse = {
  user: {
    id: "00000000-0000-4000-8000-000000000002",
    email: "sofia@example.invalid",
    emailVerified: true,
    firstName: "SOFÍA",
    lastName: "DEMO",
    legacyUser: "UI_DEMO",
    state: 1,
    isSystemAdmin: false,
    workflowOwnerId: "00000000-0000-4000-8000-000000000003",
    workflowOwner: {
      id: "00000000-0000-4000-8000-000000000003",
      code: "RIESGO",
      name: "Riesgo de ejemplo",
    },
  },
};

const approvedAttempt: ReviewAttempt = {
  verificationId: "demo-firma-001",
  completedAt: "2026-10-23T20:02:00.000Z",
  providerStatus: "verified",
  originalStatus: "verified",
  dashboardUrl: null,
  decision: "approve",
  reasons: [
    "La identidad y los datos del firmante coinciden con la solicitud de ejemplo.",
    "Los documentos requeridos fueron leídos y firmados.",
  ],
  evidenceAvailable: true,
  checks: [
    {
      code: "identity",
      label: "Identidad verificada",
      passed: true,
      expected: "Verificada",
      actual: "Verificada",
      reason: "La verificación ficticia se completó correctamente.",
    },
    {
      code: "document",
      label: "Documento del titular",
      passed: true,
      expected: HEADER_SAMPLE.document,
      actual: HEADER_SAMPLE.document,
      reason: "El documento coincide con la solicitud de ejemplo.",
    },
    {
      code: "signer",
      label: "Nombre del firmante",
      passed: true,
      expected: HEADER_SAMPLE.name,
      actual: HEADER_SAMPLE.name,
      reason: "El nombre coincide con el titular de ejemplo.",
    },
    {
      code: "documents-read",
      label: "Lectura de documentos",
      passed: true,
      expected: "2 documentos leídos",
      actual: "2 documentos leídos",
      reason: "Se registró la lectura de ambos documentos ficticios.",
    },
    {
      code: "documents-signed",
      label: "Firma de documentos",
      passed: true,
      expected: "2 documentos firmados",
      actual: "2 documentos firmados",
      reason: "Se registró la firma de ambos documentos ficticios.",
    },
  ],
  documents: [
    {
      id: "demo-documento-001",
      signer: HEADER_SAMPLE.name,
      signedAt: "2026-10-23T20:01:00.000Z",
      readAt: "2026-10-23T19:59:00.000Z",
    },
    {
      id: "demo-documento-002",
      signer: HEADER_SAMPLE.name,
      signedAt: "2026-10-23T20:02:00.000Z",
      readAt: "2026-10-23T20:00:00.000Z",
    },
  ],
};

const approvedReview: DocumentReview = {
  id: "demo-revision-001",
  evaluatedAt: "2026-10-23T20:05:00.000Z",
  policyVersion: "ui-lab-demo-v1",
  sourceFingerprint: "fixture-header-approved",
  systemDecision: "approve",
  reasons: [
    "El intento demo-firma-001 cumple todas las condiciones. Los demás intentos se conservan como evidencia.",
  ],
  selectedVerificationId: approvedAttempt.verificationId,
  artifactError: null,
  legajoAdjuntoId: null,
  attempts: [approvedAttempt],
  decisions: [
    {
      id: "demo-decision-001",
      humanDecision: "approve",
      systemDecision: "approve",
      verificationId: approvedAttempt.verificationId,
      attemptSystemDecision: "approve",
      disagreesWithSystem: false,
      overridesAttempt: false,
      reason:
        "Conforme con los controles de identidad y firma de la solicitud de ejemplo.",
      actorName: "Operador de ejemplo",
      decidedAt: "2026-10-23T20:08:00.000Z",
      legajoAdjuntoId: null,
      providerCheckedAt: approvedAttempt.completedAt,
      attemptsAtDecision: [approvedAttempt],
    },
  ],
};

export const HEADER_DOCUMENT_REVIEW_FIXTURE: DocumentReviewResponse = {
  enabled: true,
  canDecide: false,
  state: HEADER_SAMPLE.state,
  currentReview: approvedReview,
  history: [approvedReview],
};
