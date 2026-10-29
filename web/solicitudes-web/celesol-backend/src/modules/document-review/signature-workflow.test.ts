import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type SolicitudDocumentDecision, type SolicitudDocumentReview } from "@prisma/client";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import { assess, digest, hasMatchingSignedOperation, type Assessment } from "./domain";
import { candidateFixture } from "./fixtures";
import {
  canManageSignature, completedSignatureAttempts, eligibleSignatureCandidates,
  isAnalysisReady, isLegajosUser, reviewSource, signatureSummary, type SignatureSourceRow,
} from "./signature-workflow";

function sourceRow(): SignatureSourceRow {
  return {
    id: "test-application", nroSolicitud: "TEST-1", legacyOid: "101",
    signatureCycleId: null, signatureRequestedAt: null, signatureRequestReason: null,
    signatureExcludedVerificationIds: null, analisisFinalizadoAt: null,
    archivedAt: null, desembolso: null, pagoExterno: null,
    estadoActual: { code: "Confirmada", isTerminal: false },
    lineaPrestamoDescripcion: "Test", lineaPrestamoCodigoMutual: "CELESOL",
    montoAFinanciar: new Prisma.Decimal("1000"), cuotas: 6, cuotaResultante: "200,00",
    linkFirmaDigital: "https://example.invalid/sign/101",
    titular: { nombre: "Persona", apellidoDenominacion: "de Prueba", nroDocumento: "30123456" },
  } as unknown as SignatureSourceRow;
}

function observation(row: SignatureSourceRow, candidates = [candidateFixture()]): SolicitudDocumentReview {
  return {
    id: "review-1", sourceFingerprint: digest(reviewSource(row)),
    assessment: assess(reviewSource(row), candidates),
  } as unknown as SolicitudDocumentReview;
}

function approval(review: SolicitudDocumentReview) {
  return {
    id: "decision-1", review, humanDecision: "approve", legajoAdjuntoId: "private-legajo",
    verificationId: "valid-1",
  } as SolicitudDocumentDecision & { review: SolicitudDocumentReview };
}

test("signature source and approval survive analysis handoff; state alone does not change the signed operation", () => {
  const row = sourceRow(), before = digest(reviewSource(row)), review = observation(row);
  assert.equal(isAnalysisReady(row), false);
  row.estadoActual.code = "VerificarFirmaYDocumentacion";
  assert.equal(isAnalysisReady(row), true);
  assert.equal(digest(reviewSource(row)), before);
  assert.equal(signatureSummary(row, review, approval(review)).approved, true);
  row.estadoActual.code = "Revisar";
  assert.equal(isAnalysisReady(row), false);
  assert.equal(signatureSummary(row, review, approval(review)).approved, true);
});

test("the first checkmark requires a completed submission, not an opened or incomplete attempt", () => {
  const row = sourceRow(), candidate = candidateFixture();
  candidate.completedAt = null;
  const pending = assess(reviewSource(row), [candidate]);
  assert.equal(completedSignatureAttempts(pending).length, 0);
  assert.equal(signatureSummary(row, observation(row, [candidate]), null).status, "waiting");
  candidate.completedAt = "not-a-date";
  assert.equal(completedSignatureAttempts(assess(reviewSource(row), [candidate])).length, 0);
  candidate.completedAt = "2026-10-26T12:00:00Z";
  const sent = signatureSummary(row, observation(row, [candidate]), null);
  assert.equal(sent.completedAttempts, 1);
  assert.equal(sent.approved, false);
  assert.equal(sent.status, "to_review");
});

test("extra completed failed signatures do not revoke an already approved valid signature", () => {
  const row = sourceRow(), good = candidateFixture(), first = observation(row, [good]);
  const extra = candidateFixture("extra-failed");
  extra.completedAt = "2026-10-26T14:00:00Z";
  extra.resource!.identity = { status: "rejected" };
  const latest = observation(row, [extra, good]);
  const summary = signatureSummary(row, latest, approval(first));
  assert.equal(summary.approved, true);
  assert.equal(summary.completedAttempts, 2);
  assert.equal(summary.status, "approved");
});

test("an explicit new signature request excludes old attempts and removes the historical approval", () => {
  const row = sourceRow(), old = candidateFixture(), prior = observation(row);
  row.signatureCycleId = "new-request-cycle";
  row.signatureRequestedAt = new Date("2026-10-26T12:00:00Z");
  row.signatureRequestReason = "DNI borroso: repetir la firma.";
  row.signatureExcludedVerificationIds = [old.verificationId];
  const delayedOld = candidateFixture("delayed-old");
  const fresh = candidateFixture("new-completed");
  fresh.completedAt = "2026-10-26T12:01:00Z";
  assert.deepEqual(eligibleSignatureCandidates(row, [old, delayedOld, fresh]).map(c => c.verificationId), [fresh.verificationId]);
  // A delayed completion event cannot turn a previously signed document into
  // a signature made after the new request.
  assert.equal(hasMatchingSignedOperation(assess(reviewSource(row), [fresh]).attempts[0]), false);
  const steps = fresh.resource!.steps as { id: string; data?: { signedDocumentDetails?: { signedAt: string }[] } }[];
  steps.find(step => step.id === "electronic-signature-document-validation")!.data!.signedDocumentDetails![0].signedAt = fresh.completedAt;
  assert.equal(hasMatchingSignedOperation(assess(reviewSource(row), [fresh]).attempts[0]), true);
  const empty = signatureSummary(row, null, approval(prior));
  assert.equal(empty.approved, false);
  assert.equal(empty.status, "requested_again");
  assert.equal(empty.completedAttempts, 0);
  assert.match(empty.reason!, /DNI borroso/);
});

test("a signature for a replaced loan cannot satisfy the new loan even if its amount is identical", () => {
  const row = sourceRow(), prior = observation(row);
  row.legacyOid = "202";
  const summary = signatureSummary(row, prior, approval(prior));
  assert.equal(summary.approved, false);
  assert.notEqual(summary.sourceFingerprint, prior.sourceFingerprint);
});

test("a manual exception cannot accept a contract belonging to another loan or financial conditions", () => {
  const row = sourceRow(), candidate = candidateFixture();
  assert.equal(hasMatchingSignedOperation(assess(reviewSource(row), [candidate]).attempts[0]), true);
  for (const change of [
    { prestamoId: "202" }, { amount: "1001.00" }, { installments: 7 },
    { installmentAmount: "201,00" }, { dni: "40123456" },
  ]) {
    const attempt = assess({ ...reviewSource(row), ...change }, [candidate]).attempts[0];
    assert.equal(attempt.evidenceAvailable, true);
    assert.equal(hasMatchingSignedOperation(attempt), false);
  }
});

test("a historical manual approval of another loan never produces the second checkmark", () => {
  const row = sourceRow();
  const candidate = candidateFixture();
  const steps = candidate.resource!.steps as { id: string; data?: { signedDocumentDetails?: { customVariables: { request: { value: string } } }[] } }[];
  steps.find(step => step.id === "electronic-signature-document-validation")!.data!.signedDocumentDetails![0].customVariables.request.value = "previous-loan";
  const historical = observation(row, [candidate]);
  const manualOverride = approval(historical);
  manualOverride.overridesAttempt = true;
  manualOverride.reason = "Old policy allowed a manual override.";
  // The BEEX source and evidence fingerprints agree; the signed operation does not.
  assert.equal(historical.sourceFingerprint, digest(reviewSource(row)));
  assert.equal((historical.assessment as unknown as Assessment).attempts[0].evidenceAvailable, true);
  const summary = signatureSummary(row, historical, manualOverride);
  assert.equal(summary.completedAttempts, 1);
  assert.equal(summary.approved, false);
  assert.equal(summary.decisionId, null);
  assert.equal(summary.status, "to_review");
});

test("missing mandatory checks fail closed, with legacy cycle compatibility limited to the initial signature", () => {
  const row = sourceRow();
  const historical = observation(row);
  const assessment = historical.assessment as unknown as Assessment;
  assessment.attempts[0].checks = assessment.attempts[0].checks.filter(check => check.code !== "cycle");
  assert.equal(signatureSummary(row, historical, approval(historical)).approved, true);
  for (const code of ["operation", "dni", "amount", "installments", "installmentAmount"]) {
    const missing = structuredClone(historical);
    (missing.assessment as unknown as Assessment).attempts[0].checks = assessment.attempts[0].checks.filter(check => check.code !== code);
    assert.equal(signatureSummary(row, missing, approval(missing)).approved, false, code);
  }
  row.signatureCycleId = "new-cycle";
  row.signatureRequestedAt = new Date("2026-10-12T00:00:00Z");
  const newCycle = observation(row);
  (newCycle.assessment as unknown as Assessment).attempts[0].checks = (newCycle.assessment as unknown as Assessment).attempts[0].checks.filter(check => check.code !== "cycle");
  assert.equal(signatureSummary(row, newCycle, approval(newCycle)).approved, false);
});

test("Legajos permissions are independent of application owner; transfer reservation freezes signing mutations", () => {
  const row = sourceRow();
  const reviewer = { isSystemAdmin: false, workflowOwner: { code: "LEGAJOS_DIGITALES" } } as AuthUser;
  const analyst = { ...reviewer, workflowOwner: { code: "RIESGO" } } as AuthUser;
  assert.equal(isLegajosUser(reviewer), true);
  assert.equal(isLegajosUser(analyst), false);
  assert.equal(canManageSignature(row), true);
  row.desembolso = { id: "reservation" };
  assert.equal(canManageSignature(row), false);
  row.desembolso = null;
  row.pagoExterno = { id: "external-payment" };
  assert.equal(canManageSignature(row), false);
});
