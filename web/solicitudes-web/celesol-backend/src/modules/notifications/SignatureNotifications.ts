import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { SignatureNotificationEvent } from "./types";

type NotificationDb = Pick<Prisma.TransactionClient, "solicitud" | "user" | "beexNotification">;

export function signatureEventKey(parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

async function insert(
  db: NotificationDb,
  input: { recipients: string[]; solicitudId: string; loanId: string; eventKey: string; kind: string; title: string; body: string },
) {
  if (!input.recipients.length) return;
  const { recipients, ...data } = input;
  await db.beexNotification.createMany({
    data: [...new Set(recipients)].map(recipientId => ({ ...data, recipientId })),
    skipDuplicates: true,
  });
}

async function seller(db: NotificationDb, vendedorId: string | null, createdBy: string) {
  // Explicit seller takes precedence. The creator remains the legacy fallback.
  return db.user.findFirst({ where: { id: vendedorId ?? createdBy, state: 1, deletedAt: null }, select: { id: true } });
}

/** May run in the loan-linking transaction and in reconciliation after a retry. */
export async function notifySignatureLinkAvailable(db: NotificationDb, solicitudId: string) {
  const s = await db.solicitud.findUnique({ where: { id: solicitudId }, select: {
    id: true, legacyOid: true, nroSolicitud: true, linkFirmaDigital: true,
    vendedorId: true, createdBy: true, archivedAt: true,
  } });
  if (!s?.legacyOid || !s.linkFirmaDigital || s.archivedAt) return;
  const recipient = await seller(db, s.vendedorId, s.createdBy);
  await insert(db, {
    recipients: recipient ? [recipient.id] : [], solicitudId: s.id, loanId: s.legacyOid,
    eventKey: signatureEventKey(["signature_link_available", s.id, s.legacyOid]),
    kind: "signature_link_available", title: "Enlace de firma disponible",
    body: `La solicitud ${s.nroSolicitud ?? ""} ya tiene enlace para firmar el préstamo ${s.legacyOid}. Abrí la solicitud para copiarlo y enviárselo al socio.`,
  });
}

export async function notifySignatureEvent(db: NotificationDb, event: SignatureNotificationEvent) {
  const s = await db.solicitud.findUnique({ where: { id: event.solicitudId }, select: {
    legacyOid: true, vendedorId: true, createdBy: true, nroSolicitud: true, archivedAt: true,
  } });
  if (!s || s.archivedAt || s.legacyOid !== event.loanId) return;
  const key = signatureEventKey([event.type, event.solicitudId, event.loanId, event.cycleId,
    event.verificationId ?? event.requestId ?? ""]);
  if (event.type === "signature_requested") {
    const recipient = await seller(db, s.vendedorId, s.createdBy);
    await insert(db, {
      recipients: recipient ? [recipient.id] : [], solicitudId: event.solicitudId, loanId: event.loanId,
      eventKey: key, kind: event.type, title: "Legajos solicitó una nueva firma",
      body: `Solicitud ${s.nroSolicitud ?? ""}, préstamo ${event.loanId}: ${event.reason ?? "Revisá la observación de Legajos."}`,
    });
    return;
  }
  const reviewers = await db.user.findMany({ where: {
    state: 1, deletedAt: null, workflowOwner: { code: "LEGAJOS_DIGITALES", isActive: true },
  }, select: { id: true } });
  await insert(db, {
    recipients: reviewers.map(u => u.id), solicitudId: event.solicitudId, loanId: event.loanId,
    eventKey: key, kind: event.type, title: "Nueva firma para revisar",
    body: `El socio completó una firma de la solicitud ${s.nroSolicitud ?? ""}, préstamo ${event.loanId}. Está disponible en la bandeja de Legajos.`,
  });
}
