import { createHash } from "node:crypto";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  array,
  object,
  text,
  declarations,
  type Assessment,
  type Attempt,
  type Decision,
  type JsonObject,
  type ReviewSource,
} from "./domain";
import type { EvidenceGateway } from "./MetaMapGateway";

export type HumanReport = {
  id: string;
  decision: Decision;
  actor: string;
  reason: string;
  decidedAt: string;
  disagreesWithSystem: boolean;
  overridesAttempt: boolean;
};
export type LegajoInput = {
  reviewId: string;
  policyVersion: string;
  evaluatedAt: string;
  source: ReviewSource;
  assessment: Assessment;
  attempt: Attempt | null;
  resource: JsonObject | null;
  human?: HumanReport;
  includeOriginals?: boolean;
  archivedLegajo?: Buffer;
};
export type LegajoBuilder = (input: LegajoInput) => Promise<Buffer>;
const ink = rgb(0.09, 0.16, 0.23),
  teal = rgb(0.04, 0.45, 0.42),
  muted = rgb(0.4, 0.45, 0.5),
  pale = rgb(0.94, 0.96, 0.96);
const clean = (v: unknown) =>
  (text(v) ?? "No informado").replace(/[^\x20-\x7e\xa0-\xff\n]/g, "-");
const date = (v: string | null) =>
  v && Number.isFinite(Date.parse(v))
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(v))
    : "No informado";
const verdict = (v: Decision) => (v === "approve" ? "Aprobar" : "No aprobar");
const stepLabel = (id: unknown) =>
  ({
    selfie: "Prueba de vida pasiva / selfie",
    liveness: "Prueba de vida activa",
    "phone-ownership-validation": "Titularidad del teléfono",
    "template-matching": "Formato del documento",
    "document-reading": "Lectura del documento",
    "alteration-detection": "Detección de alteraciones",
    "age-check": "Control de edad",
    "argentinian-renaper-validation": "Validación RENAPER",
    facematch: "Comparación de rostro",
  })[text(id) ?? ""] ??
  text(id) ??
  "Control del proveedor";
function fit(value: unknown, font: PDFFont, size: number, width: number) {
  let result = clean(value);
  if (font.widthOfTextAtSize(result, size) <= width) return result;
  while (result && font.widthOfTextAtSize(`${result}...`, size) > width)
    result = result.slice(0, -1);
  return `${result}...`;
}

class Layout {
  page!: PDFPage;
  y = 0;
  section = "";
  constructor(
    public pdf: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private input: LegajoInput,
  ) {}
  newPage(section: string) {
    this.section = section.replace(/ \(continuación\)/g, "");
    this.page = this.pdf.addPage([595.28, 841.89]);
    this.y = 739;
    this.page.drawText(
      fit(
        this.input.source.mutual?.toUpperCase() ?? "RED UNISOL",
        this.bold,
        16,
        213,
      ),
      { x: 36, y: 797, size: 16, font: this.bold, color: teal },
    );
    this.page.drawText("Legajo de ayuda económica", {
      x: 265,
      y: 800,
      size: 13,
      font: this.bold,
      color: ink,
    });
    this.page.drawText("Firma, evidencia y revisión de la operación", {
      x: 265,
      y: 783,
      size: 9,
      font: this.font,
      color: muted,
    });
    this.page.drawLine({
      start: { x: 36, y: 769 },
      end: { x: 559, y: 769 },
      color: teal,
      thickness: 1,
    });
    this.page.drawText(clean(section), {
      x: 36,
      y: this.y,
      size: 13,
      font: this.bold,
      color: ink,
    });
    this.y -= 26;
  }
  private wrapped(value: unknown, width: number, size: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of clean(value).replace(/\n/g, " ").split(/\s+/)) {
      if (this.font.widthOfTextAtSize(word, size) > width) {
        if (line) lines.push(line);
        let chunk = "";
        for (const ch of word) {
          if (this.font.widthOfTextAtSize(chunk + ch, size) > width) {
            lines.push(chunk);
            chunk = "";
          }
          chunk += ch;
        }
        line = chunk;
        continue;
      }
      const next = line ? `${line} ${word}` : word;
      if (line && this.font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines.length ? lines : ["-"];
  }
  ensure(height: number) {
    if (this.y - height < 65) this.newPage(`${this.section} (continuación)`);
  }
  paragraph(value: unknown, size = 10) {
    for (const line of this.wrapped(value, 523, size)) {
      this.ensure(size + 5);
      this.page.drawText(line, {
        x: 36,
        y: this.y,
        size,
        font: this.font,
        color: ink,
      });
      this.y -= size + 5;
    }
    this.y -= 6;
  }
  heading(value: string) {
    this.ensure(35);
    this.y -= 8;
    this.page.drawText(clean(value), {
      x: 36,
      y: this.y,
      size: 11,
      font: this.bold,
      color: teal,
    });
    this.y -= 21;
  }
  row(name: unknown, value: unknown) {
    const left = this.wrapped(name, 153, 9),
      right = this.wrapped(value, 338, 10);
    const length = Math.max(left.length, right.length);
    let offset = 0;
    while (offset < length) {
      this.ensure(29);
      const count = Math.min(length - offset, Math.floor((this.y - 80) / 14));
      const height = count * 14 + 12;
      this.page.drawRectangle({
        x: 36,
        y: this.y - height + 8,
        width: 523,
        height,
        color: pale,
      });
      left
        .slice(offset, offset + count)
        .forEach((line, i) =>
          this.page.drawText(line, {
            x: 43,
            y: this.y - i * 14,
            size: 9,
            font: this.bold,
            color: muted,
          }),
        );
      right
        .slice(offset, offset + count)
        .forEach((line, i) =>
          this.page.drawText(line, {
            x: 209,
            y: this.y - i * 14,
            size: 10,
            font: this.font,
            color: ink,
          }),
        );
      this.y -= height + 3;
      offset += count;
      if (offset < length) this.newPage(`${this.section} (continuación)`);
    }
  }
  finish() {
    const pages = this.pdf.getPages();
    pages.forEach((page, i) => {
      page.drawLine({
        start: { x: 36, y: 48 },
        end: { x: 559, y: 48 },
        thickness: 0.4,
        color: pale,
      });
      page.drawText(
        fit(
          `${this.input.source.name} | DNI ${this.input.source.dni ?? "-"}`,
          this.font,
          7,
          257,
        ),
        { x: 36, y: 33, size: 7, font: this.font, color: muted },
      );
      page.drawText(`${i + 1} / ${pages.length}`, {
        x: 315,
        y: 33,
        size: 7,
        font: this.font,
        color: muted,
      });
      page.drawText("Powered by Red Unisol", {
        x: 453,
        y: 33,
        size: 7,
        font: this.font,
        color: muted,
      });
    });
  }
}

export function createLegajoBuilder(
  gateway: Pick<EvidenceGateway, "download">,
): LegajoBuilder {
  return async (input) => {
    const pdf = await PDFDocument.create();
    pdf.setTitle(
      `Legajo de ayuda económica - ${input.source.nroSolicitud ?? input.source.solicitudId}`,
    );
    pdf.setAuthor("Red Unisol");
    pdf.setCreator("BEEX");
    pdf.setProducer("Red Unisol");
    pdf.setLanguage("es-AR");
    const font = await pdf.embedFont(StandardFonts.Helvetica),
      bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const l = new Layout(pdf, font, bold, input),
      r = input.resource ?? {},
      a = input.attempt;
    l.newPage("1. Resumen");
    l.heading("Persona y operación");
    for (const [k, v] of Object.entries({
      Nombre: input.source.name,
      DNI: input.source.dni,
      "Fecha de nacimiento": input.source.birthDate,
      Domicilio: input.source.address,
      Teléfono: input.source.phone,
      "Correo electrónico": input.source.email,
      "Solicitud BEEX": input.source.nroSolicitud,
      "ID de solicitud": input.source.solicitudId,
      "ID del préstamo": input.source.prestamoId,
      Línea: input.source.line,
      "ID de verificación": a?.verificationId,
      "ID del legajo / revisión": input.reviewId,
    }))
      l.row(k, v);
    l.heading("Decisiones independientes");
    l.row("Propuesta del sistema", verdict(input.assessment.decision));
    l.row(
      "Decisión humana",
      input.human
        ? verdict(input.human.decision)
        : "Pendiente. La solicitud no avanza automáticamente.",
    );
    l.row("MetaMap vigente", a?.providerStatus);
    l.row("Consulta y evaluación", date(input.evaluatedAt));

    l.newPage("2. Evidencia documental y biométrica");
    const idDoc = array(r.documents)
      .map(object)
      .find((d) => d.type === "national-id");
    const photoValues = array(idDoc?.photos);
    const photoUrls = photoValues.map((v) =>
      text(typeof v === "string" ? v : object(v).url),
    );
    const selfie = array(r.steps)
      .map(object)
      .find((s) => s.id === "selfie");
    const images = [
      { name: "DNI frente", url: photoUrls[0] },
      { name: "DNI dorso", url: photoUrls[1] },
      { name: "Selfie", url: text(object(selfie?.data).selfiePhotoUrl) },
    ];
    if (a?.evidenceAvailable && input.includeOriginals !== false) {
      for (let i = 0; i < images.length; i++) {
        const item = images[i],
          x = 36 + i * 179;
        l.page.drawText(item.name, {
          x,
          y: l.y,
          size: 9,
          font: bold,
          color: muted,
        });
        if (!item.url)
          throw new Error(
            "Falta una imagen requerida en la evidencia del legajo.",
          );
        const bytes = await gateway.download(item.url);
        const image =
          bytes[0] === 0x89
            ? await pdf.embedPng(bytes)
            : await pdf.embedJpg(bytes);
        const scale = Math.min(164 / image.width, 175 / image.height);
        l.page.drawImage(image, {
          x: x + (164 - image.width * scale) / 2,
          y: l.y - 190,
          width: image.width * scale,
          height: image.height * scale,
        });
      }
      l.y -= 215;
    } else
      l.paragraph(
        input.includeOriginals === false
          ? "La evidencia consultada por el sistema se conserva en el legajo de propuesta de esta revisión, incorporado como archivo adjunto cuando estuvo disponible. La decisión humana se registra por separado."
          : "No se pudo compilar la evidencia de un intento firmado. Este documento conserva los motivos de la revisión.",
      );
    const steps = [
      ...array(r.steps).map(object),
      ...array(r.documents)
        .map(object)
        .flatMap((d) => array(d.steps).map(object)),
    ];
    for (const s of steps.filter(
      (s) =>
        s.id !== "watchlists" &&
        s.id !== "electronic-signature-document-validation",
    )) {
      const error = object(s.error),
        data = object(s.data);
      const detail =
        text(error.message) ??
        text(error.code) ??
        (s.id === "facematch"
          ? `Puntaje: ${text(data.score) ?? "-"}`
          : "");
      l.row(
        stepLabel(s.id),
        `${s.error ? "Con observación" : "Sin error informado"}. Estado: ${text(s.status) ?? "no informado"}${detail ? `. ${detail}` : ""}`,
      );
    }
    if (!steps.some((s) => s.id === "liveness"))
      l.row(
        "Prueba de vida activa",
        "No informada por el proveedor. Se distingue de la prueba pasiva.",
      );

    l.newPage("3. Declaraciones y listas");
    l.heading("Declaraciones de la persona");
    for (const f of declarations(r))
      l.row(
        f.title ?? f.name,
        typeof f.value === "boolean" ? (f.value ? "Sí" : "No") : text(f.value),
      );
    if (!declarations(r).length) l.paragraph("Declaraciones no disponibles.");
    l.heading("Listas consultadas");
    const watchlists = array(
      array(r.steps)
        .map(object)
        .find((s) => s.id === "watchlists")?.data,
    ).map(object);
    for (const w of watchlists)
      l.row(
        text(object(w.watchlist).name),
        `${w.searchResult ? "Coincidencia informada: revisar" : "Sin coincidencias informadas"} | ${date(text(w.searchedAt))}`,
      );
    if (!watchlists.length)
      l.paragraph("No hay resultados de listas disponibles.");

    l.newPage("4. Firma y condiciones de la operación");
    for (const [i, d] of (a?.documents ?? []).entries()) {
      l.heading(`Documento firmado ${i + 1}`);
      l.row("ID del documento", d.id);
      l.row("Firmante", d.signer);
      l.row("Lectura", date(d.readAt));
      l.row("Firma", date(d.signedAt));
      for (const v of d.variables) l.row(v.title, v.value);
    }
    if (!a?.documents.length)
      l.paragraph("No se informaron documentos firmados disponibles.");
    l.heading("Cruce con los datos de BEEX");
    for (const c of a?.checks ?? [])
      l.row(
        c.label,
        `${c.passed ? "Conforme" : "No conforme"} | BEEX: ${c.expected ?? "no informado"} | MetaMap: ${c.actual ?? "no informado"}`,
      );

    l.newPage("5. Trazabilidad y decisiones");
    l.row("Versión de reglas", input.policyVersion);
    l.row("Estado original de MetaMap", a?.originalStatus);
    l.row("Estado vigente consultado", a?.providerStatus);
    l.row("Fin del procesamiento", date(a?.completedAt ?? null));
    l.heading("Decisión que hubiera tomado el sistema");
    l.row("Propuesta", verdict(input.assessment.decision));
    for (const reason of input.assessment.reasons) l.paragraph(reason);
    l.heading("Intentos de firma");
    for (const attempt of input.assessment.attempts) {
      l.row(
        attempt.verificationId,
        `${verdict(attempt.decision)} | MetaMap: ${attempt.providerStatus ?? "no disponible"} | ${date(attempt.completedAt)}`,
      );
      for (const reason of attempt.reasons) l.paragraph(reason, 9);
    }
    l.heading("Decisión humana");
    if (input.human) {
      l.row("Decisión", verdict(input.human.decision));
      l.row("Responsable", input.human.actor);
      l.row("Fecha", date(input.human.decidedAt));
      l.row(
        "Motivo",
        input.human.reason || "Conforme con la propuesta del sistema.",
      );
      l.row(
        "Disparidad con el sistema",
        input.human.disagreesWithSystem ? "Sí" : "No",
      );
      l.row(
        "Excepción sobre el intento",
        input.human.overridesAttempt ? "Sí" : "No",
      );
      l.row("ID de decisión", input.human.id);
    } else
      l.paragraph(
        "Pendiente. Este legajo documenta una propuesta y no autoriza por sí solo el avance a Transferir.",
      );

    l.newPage("6. Anexos: documentos firmados originales");
    l.paragraph(
      input.includeOriginals === false
        ? "La propuesta original se conserva sin modificar sus bytes. Sus anexos contienen la evidencia consultada antes de la decisión humana."
        : "Cada original firmado se reproduce a continuación y se incorpora como archivo adjunto embebido, sin modificar sus bytes. Este legajo es una compilación de la evidencia y de las decisiones de revisión.",
    );
    if (input.archivedLegajo) {
      await pdf.attach(input.archivedLegajo, "legajo-propuesta-sistema.pdf", {
        mimeType: "application/pdf",
        description: "Propuesta original y evidencia del sistema",
      });
      l.row("Propuesta original embebida", "legajo-propuesta-sistema.pdf");
      l.row(
        "SHA-256 de la propuesta",
        createHash("sha256").update(input.archivedLegajo).digest("hex"),
      );
    }
    const originals: {
      name: string;
      bytes: Buffer;
      id: string;
      pages: number;
    }[] = [];
    let totalBytes = 0,
      totalPages = 0;
    for (const [i, d] of (a?.documents ?? []).entries()) {
      if (
        !d.url ||
        !d.signedAt ||
        !a?.evidenceAvailable ||
        input.includeOriginals === false
      )
        continue;
      const bytes = await gateway.download(d.url);
      totalBytes += bytes.length;
      if (totalBytes > 64 * 1024 * 1024)
        throw new Error(
          "Los originales superan el tamaño admitido para el legajo.",
        );
      const original = await PDFDocument.load(bytes);
      const pages = original.getPageCount();
      totalPages += pages;
      if (!pages || totalPages > 150)
        throw new Error(
          "Los originales superan la cantidad admitida de páginas.",
        );
      const name = `anexo-A${i + 1}-${d.id.replace(/[^a-zA-Z0-9-]/g, "")}.pdf`;
      originals.push({ name, bytes, id: d.id, pages });
      l.row(`Anexo A${i + 1}`, `${name} | ${pages} páginas`);
      l.row(
        "SHA-256 del original",
        createHash("sha256").update(bytes).digest("hex"),
      );
      await pdf.attach(bytes, name, {
        mimeType: "application/pdf",
        description: `Documento firmado original ${i + 1}`,
      });
    }
    for (const [i, original] of originals.entries()) {
      const embedded = await pdf.embedPdf(
        original.bytes,
        Array.from({ length: original.pages }, (_, j) => j),
      );
      for (const [j, page] of embedded.entries()) {
        l.newPage(
          `Anexo A${i + 1} - Documento firmado - ${j + 1} de ${original.pages}`,
        );
        const scale = Math.min(523 / page.width, 645 / page.height);
        l.page.drawPage(page, {
          x: 36 + (523 - page.width * scale) / 2,
          y: 65 + (645 - page.height * scale) / 2,
          width: page.width * scale,
          height: page.height * scale,
        });
      }
    }
    l.finish();
    return Buffer.from(await pdf.save());
  };
}
