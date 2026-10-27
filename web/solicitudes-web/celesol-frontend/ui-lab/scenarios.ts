import type { SignatureSummary } from "../src/modules/solicitudes-core/services/document-review-api";
import type { LinkedLoanStatus } from "../src/modules/solicitudes-core/services/linked-loan-status-api";

export type Scenario = {
  id: string;
  title: string;
  state: string;
  analysisReady: boolean;
  loan: LinkedLoanStatus;
  signature: SignatureSummary;
};
const signature: SignatureSummary = {
  status: "waiting",
  completedAttempts: 0,
  lastCompletedAt: null,
  approved: false,
  reason: null,
  link: "https://firma.invalid/demo-999001",
  cycle: "demo-cycle-1",
  decisionId: null,
};
const loan: LinkedLoanStatus = {
  status: "active",
  currentLoanId: "999001",
  amount: 600000,
  requestedAmount: 600000,
  matchesAmount: true,
  amountEditable: false,
};
export const SCENARIOS: Scenario[] = [
  {
    id: "new",
    title: "Sin préstamo",
    state: "Confirmada",
    analysisReady: false,
    loan: {
      ...loan,
      status: "none",
      currentLoanId: null,
      amount: null,
      amountEditable: true,
    },
    signature: { ...signature, link: null },
  },
  {
    id: "compatible",
    title: "Préstamo vigente · esperando firma",
    state: "Confirmada",
    analysisReady: false,
    loan,
    signature,
  },
  {
    id: "mismatch",
    title: "Préstamo con monto distinto",
    state: "Confirmada",
    analysisReady: false,
    loan: { ...loan, amount: 500000, matchesAmount: false },
    signature,
  },
  {
    id: "cancelled",
    title: "Préstamo anulado · regenerar",
    state: "Confirmada",
    analysisReady: false,
    loan: { ...loan, status: "cancelled", amountEditable: true },
    signature: { ...signature, link: null },
  },
  {
    id: "unavailable",
    title: "Vimarx no disponible",
    state: "Confirmada",
    analysisReady: false,
    loan: { ...loan, status: "unavailable" },
    signature,
  },
  {
    id: "submitted",
    title: "Firma enviada · análisis en curso",
    state: "Confirmada",
    analysisReady: false,
    loan,
    signature: {
      ...signature,
      status: "to_review",
      completedAttempts: 1,
      lastCompletedAt: "2026-10-26T15:30:00Z",
    },
  },
  {
    id: "analysis-ready",
    title: "Análisis terminado · firma pendiente",
    state: "VerificarFirmaYDocumentacion",
    analysisReady: true,
    loan,
    signature,
  },
  {
    id: "approved",
    title: "Firma aprobada antes del análisis",
    state: "Confirmada",
    analysisReady: false,
    loan,
    signature: {
      ...signature,
      status: "approved",
      completedAttempts: 1,
      lastCompletedAt: "2026-10-26T15:30:00Z",
      approved: true,
      decisionId: "demo-decision-1",
    },
  },
  {
    id: "requested",
    title: "Nueva firma solicitada",
    state: "VerificarFirmaYDocumentacion",
    analysisReady: true,
    loan,
    signature: {
      ...signature,
      status: "requested_again",
      cycle: "demo-cycle-2",
      reason:
        "El DNI quedó borroso. Pedile al socio que repita la firma con buena iluminación.",
    },
  },
];
export function getScenario(id: string | null): Scenario {
  return structuredClone(
    SCENARIOS.find((item) => item.id === id) ?? SCENARIOS[0],
  );
}
