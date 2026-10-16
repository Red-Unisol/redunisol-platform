import assert from "node:assert/strict";
import test from "node:test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { assess } from "./domain";
import { candidateFixture, sourceFixture } from "./fixtures";
import { createLegajoBuilder } from "./LegajoPdf";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhPQAAAAASUVORK5CYII=",
  "base64",
);
async function originalPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Contrato de prueba firmado.");
  return Buffer.from(await pdf.save());
}
function embeddedBytes(pdf: PDFDocument) {
  const names = pdf.catalog
    .lookup(PDFName.of("Names"), PDFDict)
    .lookup(PDFName.of("EmbeddedFiles"), PDFDict)
    .lookup(PDFName.of("Names"), PDFArray);
  const spec = names.lookup(1, PDFDict);
  const stream = spec.lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F"));
  assert(stream instanceof PDFRawStream);
  return Buffer.from(decodePDFRawStream(stream).decode());
}
test("legajo compiles sections and signed pages while embedding byte-identical originals", async () => {
  const original = await originalPdf(),
    c = candidateFixture(),
    source = sourceFixture(),
    assessment = assess(source, [c]);
  const builder = createLegajoBuilder({
    download: async (url) => (url.endsWith(".pdf") ? original : png),
  });
  const bytes = await builder({
    reviewId: source.solicitudId,
    source,
    assessment,
    attempt: assessment.attempts[0],
    resource: c.resource,
    policyVersion: "test/1",
    evaluatedAt: "2026-10-13T12:00:00Z",
  });
  const pdf = await PDFDocument.load(bytes);
  assert(pdf.getPageCount() >= 7);
  assert.equal(pdf.getAuthor(), "Red Unisol");
  assert.deepEqual(embeddedBytes(pdf), original);
});
test("rejected human decision can preserve the original proposal without calling MetaMap again", async () => {
  const archive = await originalPdf(),
    source = sourceFixture(),
    assessment = assess(source, []);
  const builder = createLegajoBuilder({
    download: async () => {
      throw new Error("No provider network for rejection");
    },
  });
  const bytes = await builder({
    reviewId: source.solicitudId,
    source,
    assessment,
    attempt: null,
    resource: null,
    policyVersion: "test/1",
    evaluatedAt: "2026-10-13T12:00:00Z",
    includeOriginals: false,
    archivedLegajo: archive,
    human: {
      id: "decision-test",
      actor: "Revisor de Prueba",
      decision: "not_approve",
      reason: "Solicitar nueva firma.",
      decidedAt: "2026-10-13T13:00:00Z",
      disagreesWithSystem: false,
      overridesAttempt: false,
    },
  });
  assert.deepEqual(embeddedBytes(await PDFDocument.load(bytes)), archive);
});
test("long reasons, variable values and many attempts paginate without truncation", async () => {
  const source = sourceFixture();
  source.name = "Nombre largo ".repeat(8);
  const assessment = assess(source, []);
  assessment.reasons = Array.from(
    { length: 30 },
    (_, i) => `Motivo ${i}: ` + "texto de prueba ".repeat(60),
  );
  const bytes = await createLegajoBuilder({
    download: async () => {
      throw new Error("unused");
    },
  })({
    reviewId: source.solicitudId,
    source,
    assessment,
    attempt: null,
    resource: null,
    policyVersion: "test/1",
    evaluatedAt: "2026-10-13T12:00:00Z",
    human: {
      id: "long-reason",
      decision: "not_approve",
      actor: "Revisor",
      reason: "Motivo muy extenso ".repeat(220),
      decidedAt: "2026-10-13T13:00:00Z",
      disagreesWithSystem: false,
      overridesAttempt: false,
    },
  });
  assert((await PDFDocument.load(bytes)).getPageCount() > 6);
});
