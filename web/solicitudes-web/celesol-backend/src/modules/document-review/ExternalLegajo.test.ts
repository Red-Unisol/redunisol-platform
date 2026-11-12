import assert from "node:assert/strict";
import test from "node:test";
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import {
  buildExternalLegajo,
  externalDocuments,
  type ExternalFile,
} from "./ExternalLegajo";
import { sourceFixture } from "./fixtures";

export async function externalPdfFixture(): Promise<ExternalFile> {
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText("Legajo externo de prueba. Firmas en papel o PDF exportado.");
  return {
    name: "legajo-exportado.pdf",
    contentType: "application/pdf",
    bytes: Buffer.from(await pdf.save()),
  };
}

test("external PDF pages are readable and original bytes remain embedded without MetaMap", async () => {
  const file = await externalPdfFixture();
  const documents = externalDocuments([file]);
  const bytes = await buildExternalLegajo({
    source: sourceFixture(),
    files: [file],
    documents,
    actor: "Revisor",
    reason: "MetaMap sin conexión",
    decidedAt: new Date(),
    decisionId: "test",
  });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  const names = pdf.catalog
    .lookup(PDFName.of("Names"), PDFDict)
    .lookup(PDFName.of("EmbeddedFiles"), PDFDict)
    .lookup(PDFName.of("Names"), PDFArray);
  const stream = names
    .lookup(1, PDFDict)
    .lookup(PDFName.of("EF"), PDFDict)
    .lookup(PDFName.of("F"));
  assert(stream instanceof PDFRawStream);
  assert.deepEqual(
    Buffer.from(decodePDFRawStream(stream).decode()),
    file.bytes,
  );
  assert.match(documents[0]!.sha256, /^[a-f0-9]{64}$/);
});

test("external photos are rendered; content spoofing, empty, oversize and corrupt documents fail", async () => {
  const photo: ExternalFile = {
    name: "foto.png",
    contentType: "image/png",
    bytes: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhPQAAAAASUVORK5CYII=",
      "base64",
    ),
  };
  const input = {
    source: sourceFixture(),
    files: [photo],
    documents: externalDocuments([photo]),
    actor: "Revisor",
    reason: "Firmado en papel",
    decidedAt: new Date(),
    decisionId: "photo-test",
  };
  assert.equal(
    (await PDFDocument.load(await buildExternalLegajo(input))).getPageCount(),
    2,
  );
  assert.throws(() => externalDocuments([]));
  assert.throws(() => externalDocuments(Array(11).fill(photo)));
  assert.throws(() =>
    externalDocuments([{ ...photo, contentType: "application/pdf" }]),
  );
  assert.throws(() =>
    externalDocuments([{ ...photo, bytes: Buffer.alloc(0) }]),
  );
  assert.throws(() =>
    externalDocuments([
      { ...photo, bytes: Buffer.alloc(10 * 1024 * 1024 + 1) },
    ]),
  );
  const corrupt = {
    name: "bad.pdf",
    contentType: "application/pdf",
    bytes: Buffer.from("%PDF-corrupt"),
  };
  await assert.rejects(
    buildExternalLegajo({
      ...input,
      files: [corrupt],
      documents: externalDocuments([corrupt]),
    }),
    /No se pudo leer/,
  );
});
