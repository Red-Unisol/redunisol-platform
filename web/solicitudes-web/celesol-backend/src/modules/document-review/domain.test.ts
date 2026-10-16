import assert from "node:assert/strict";
import test from "node:test";
import {
  assess,
  assessAttempt,
  decisionDisparity,
  money,
  object,
  providerFingerprint,
} from "./domain";
import { candidateFixture, sourceFixture } from "./fixtures";

test("all agreed controls are required; formatted DNI/ARS and decimal rounding agree", () => {
  const result = assess(sourceFixture(), [candidateFixture()]);
  assert.equal(result.decision, "approve");
  assert.equal(
    result.attempts[0].checks.every((c) => c.passed),
    true,
  );
  assert.equal(money("$ 1.000,00", true), "1000.00");
  assert.equal(money("200,0049", true), "200.00");
  assert.equal(money("$ 200,01", true), "200.01");
  for (const value of ["NaN", "1e3", "-100", "$ 1.2.3,00", "1,00,00"])
    assert.equal(money(value, true), null);
});
test("PEP affirmative, absent, ambiguous or only defaultValue never auto-approve", () => {
  for (const value of [true, null, "", undefined, "sí"]) {
    const candidate = candidateFixture();
    const fields = object(candidate.resource?.customInputValues).fields as {
      atomicFieldParams: { value?: unknown; defaultValue: boolean };
    }[];
    fields[0].atomicFieldParams.value = value;
    assert.equal(
      assessAttempt(sourceFixture(), candidate).decision,
      "not_approve",
    );
  }
  const c = candidateFixture();
  c.resource!.customInputValues = { fields: [] };
  assert.equal(
    assessAttempt(sourceFixture(), c).checks.find((c) => c.code === "pep")
      ?.passed,
    false,
  );
});
test("only current verified is green: completed/original verified cannot override a rejection", () => {
  for (const status of [
    "reviewNeeded",
    "rejected",
    "pending",
    "postponed",
    null,
  ]) {
    const c = candidateFixture();
    c.resource!.identity = { status };
    assert.equal(assessAttempt(sourceFixture(), c).decision, "not_approve");
  }
  const c = candidateFixture();
  c.originalStatus = "reviewNeeded";
  assert.equal(
    assessAttempt(sourceFixture(), c).decision,
    "approve",
    "human-green status in MetaMap is its current state",
  );
});
test("each financial/document/reference mismatch or missing signed value refuses approval", () => {
  const source = sourceFixture();
  for (const patch of [
    { amount: "1000.01" },
    { dni: "30123457" },
    { installments: 7 },
    { installmentAmount: "200,01" },
    { prestamoId: "102" },
    { amount: null },
  ]) {
    assert.equal(
      assess({ ...source, ...patch }, [candidateFixture()]).decision,
      "not_approve",
    );
  }
  const c = candidateFixture();
  c.resource!.steps = [];
  assert.equal(assess(source, [c]).decision, "not_approve");
});
test("multiple attempts: an older correct signature suffices despite a newer failed/unreadable one", () => {
  const good = candidateFixture("good-old");
  const bad = candidateFixture("bad-new");
  bad.completedAt = "2026-10-13T15:00:00Z";
  bad.resource!.identity = { status: "rejected" };
  const unavailable = candidateFixture("unavailable");
  unavailable.resource = null;
  unavailable.error = "No se pudo consultar";
  const result = assess(sourceFixture(), [bad, good, unavailable, good]);
  assert.equal(result.decision, "approve");
  assert.equal(result.selectedVerificationId, "good-old");
  assert.equal(result.attempts.length, 3);
  assert.equal(
    assess(sourceFixture(), [bad, unavailable]).decision,
    "not_approve",
  );
});
test("conflicting variables in different signed documents are ambiguous, never cherry-picked", () => {
  const c = candidateFixture();
  const data = object(
    (c.resource!.steps as { id: string; data: unknown }[]).find(
      (s) => s.id === "electronic-signature-document-validation",
    )!.data,
  );
  const docs = data.signedDocumentDetails as unknown[];
  docs.push({
    documentId: "other-document",
    signedAt: "2026-10-13T12:00:00Z",
    pdfDocumentUrl: "https://media.prod.metamap.com/other.pdf",
    customVariables: {
      amount: { title: "Importe solicitado", value: "$ 900,00" },
    },
  });
  assert.equal(
    assessAttempt(sourceFixture(), c).checks.find((c) => c.code === "amount")
      ?.passed,
    false,
  );
});
test("fingerprints ignore rotating signed media URLs but detect decision/data/new-attempt changes", () => {
  const c = candidateFixture(),
    hash = providerFingerprint([c]);
  c.resource!.documents = (c.resource!.documents as { photos: string[] }[]).map(
    (d) => ({ ...d, photos: d.photos.map((p) => p + "?Expires=999") }),
  );
  assert.equal(providerFingerprint([c]), hash);
  const changedMedia = structuredClone(c);
  (changedMedia.resource!.documents as { photos: string[] }[])[0].photos[0] =
    "https://media.prod.metamap.com/different-front.png";
  assert.notEqual(providerFingerprint([changedMedia]), hash);
  c.resource!.identity = { status: "rejected" };
  assert.notEqual(providerFingerprint([c]), hash);
  assert.notEqual(
    providerFingerprint([candidateFixture(), candidateFixture("second")]),
    hash,
  );
});
test("aggregate disparities and choosing an individually failed attempt are independently recorded", () => {
  const bad = candidateFixture();
  bad.resource!.identity = { status: "reviewNeeded" };
  assert.deepEqual(decisionDisparity("approve", "not_approve", null), {
    disagreesWithSystem: true,
    overridesAttempt: false,
  });
  assert.deepEqual(
    decisionDisparity(
      "approve",
      "approve",
      assessAttempt(sourceFixture(), bad),
    ),
    { disagreesWithSystem: false, overridesAttempt: true },
  );
});
