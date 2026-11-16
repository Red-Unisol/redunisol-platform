import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { DocumentReviewError, type ReviewSource } from "./domain";
import {
  MAX_EXTERNAL_FILES,
  MAX_EXTERNAL_FILE_BYTES,
  MAX_EXTERNAL_TOTAL_BYTES,
  type ExternalDocument,
} from "./external-legajo-policy";

export type ExternalFile = { name: string; contentType: string; bytes: Buffer };

export function externalDocuments(files: ExternalFile[]): ExternalDocument[] {
  if (!files.length || files.length > MAX_EXTERNAL_FILES)
    throw new DocumentReviewError(
      `Adjuntá entre 1 y ${MAX_EXTERNAL_FILES} archivos.`,
      400,
    );
  if (
    files.reduce((size, file) => size + file.bytes.length, 0) >
    MAX_EXTERNAL_TOTAL_BYTES
  )
    throw new DocumentReviewError(
      "Los archivos del legajo superan 32 MiB en total.",
      400,
    );
  return files.map((file) => {
    if (!file.bytes.length || file.bytes.length > MAX_EXTERNAL_FILE_BYTES)
      throw new DocumentReviewError(
        "Cada archivo debe tener contenido y ocupar hasta 10 MiB.",
        400,
      );
    const header = file.bytes;
    const detected =
      header.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : header
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "image/png"
          : header[0] === 255 && header[1] === 216 && header[2] === 255
            ? "image/jpeg"
            : null;
    if (!detected || detected !== file.contentType)
      throw new DocumentReviewError(
        "Solo se admiten archivos PDF, JPG o PNG válidos.",
        400,
      );
    return {
      name:
        Array.from(file.name.split(/[\\/]/).at(-1)!)
          .filter(
            (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
          )
          .join("")
          .slice(0, 160) || "archivo",
      contentType: detected,
      size: header.length,
      sha256: createHash("sha256").update(header).digest("hex"),
    };
  });
}

export async function buildExternalLegajo(input: {
  source: ReviewSource;
  files: ExternalFile[];
  documents: ExternalDocument[];
  actor: string;
  reason: string;
  decidedAt: Date;
  decisionId: string;
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage,
    y = 0;
  const clean = (value: string) => value.replace(/[^\x20-\x7e\xa0-\xff]/g, " ");
  function write(value: string, heading = false) {
    // Wrap long names, hashes and reasons as well as normal prose.
    const selectedFont = heading ? bold : font;
    let line = "";
    for (const character of clean(value) + "\n") {
      if (
        character === "\n" ||
        selectedFont.widthOfTextAtSize(line + character, 10) > 510
      ) {
        if (y < 45) {
          page = pdf.addPage([595, 842]);
          y = 795;
        }
        page.drawText(line, {
          x: 42,
          y,
          size: 10,
          font: selectedFont,
          color: rgb(0.1, 0.16, 0.22),
        });
        y -= 16;
        line = "";
      }
      if (character !== "\n") line += character;
    }
  }
  page = pdf.addPage([595, 842]);
  y = 795;
  write("RED UNISOL - Legajo externo aprobado", true);
  write(
    "Evidencia aportada y verificada por el revisor; sin validación automática de MetaMap.",
  );
  write(
    `Solicitud Beex: ${input.source.nroSolicitud ?? input.source.solicitudId}`,
  );
  write(
    `Préstamo: ${input.source.prestamoId}; titular: ${input.source.name}; DNI: ${input.source.dni}`,
  );
  write(
    `Monto: ${input.source.amount}; cuotas: ${input.source.installments}; cuota: ${input.source.installmentAmount}`,
  );
  write(`Revisor: ${input.actor}; fecha: ${input.decidedAt.toISOString()}`);
  write(`Decisión: ${input.decisionId}`);
  write(`Motivo: ${input.reason}`);
  write(
    "El revisor confirmó titular, préstamo, condiciones y firmas del legajo adjunto.",
  );
  write("Los originales se conservan embebidos, sin alterar sus bytes.");
  for (const [index, document] of input.documents.entries()) {
    write(`${index + 1}. ${document.name} (${document.size} bytes)`, true);
    write(`SHA-256: ${document.sha256}`);
  }
  for (const [index, file] of input.files.entries()) {
    const document = input.documents[index]!;
    try {
      if (document.contentType === "application/pdf") {
        const original = await PDFDocument.load(file.bytes);
        const count = original.getPageCount();
        if (!count || pdf.getPageCount() + count > 150)
          throw new Error("page limit");
        for (const copied of await pdf.copyPages(
          original,
          original.getPageIndices(),
        ))
          pdf.addPage(copied);
      } else {
        const image =
          document.contentType === "image/png"
            ? await pdf.embedPng(file.bytes)
            : await pdf.embedJpg(file.bytes);
        if (
          image.width * image.height > 40_000_000 ||
          pdf.getPageCount() >= 150
        )
          throw new Error("image limit");
        const imagePage = pdf.addPage([595, 842]);
        const dimensions = image.scale(
          Math.min(511 / image.width, 758 / image.height, 1),
        );
        imagePage.drawImage(image, {
          x: (595 - dimensions.width) / 2,
          y: (842 - dimensions.height) / 2,
          ...dimensions,
        });
      }
      await pdf.attach(file.bytes, `${index + 1}-${document.name}`, {
        mimeType: document.contentType,
        description: `Original del legajo externo. SHA-256: ${document.sha256}`,
      });
    } catch {
      throw new DocumentReviewError(
        "No se pudo leer un archivo. Usá PDF sin contraseña o fotos JPG/PNG; hasta 150 páginas en total.",
        400,
      );
    }
  }
  pdf.setTitle("Legajo externo aprobado");
  pdf.setCreationDate(input.decidedAt);
  return Buffer.from(await pdf.save());
}
