import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuthUser } from "../auth/domain/entities/User.entity";
import type { AdjuntosObjectStorage } from "../solicitudes-core/adjuntos/domain/services/AdjuntosObjectStorage";
import { fail, hash } from "./domain";
import {
  externalPaymentInput,
  type ExternalPaymentInput,
} from "./external-payment-input";
import type { createPayWorkflow } from "./workflow";

const include = {
  estadoActual: { include: { owner: true } },
  desembolso: { include: { pagos: true } },
  pagoExterno: {
    include: {
      recordedByUser: {
        select: { firstName: true, lastName: true, legacyUser: true },
      },
    },
  },
} satisfies Prisma.SolicitudInclude;
type Source = Prisma.SolicitudGetPayload<{ include: typeof include }>;
type Db = PrismaClient | Prisma.TransactionClient;

export function argentinaToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(now);
}

export function receiptFormat(body: Buffer) {
  if (
    body.subarray(0, 5).equals(Buffer.from("%PDF-")) &&
    body.subarray(-1024).includes(Buffer.from("%%EOF"))
  )
    return { extension: "pdf", mime: "application/pdf" };
  if (
    body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { extension: "png", mime: "image/png" };
  if (
    body.subarray(0, 3).equals(Buffer.from([255, 216, 255])) &&
    body.subarray(-2).equals(Buffer.from([255, 217]))
  )
    return { extension: "jpg", mime: "image/jpeg" };
  return fail(
    "INVALID_RECEIPT",
    "Adjuntá un comprobante PDF, JPG o PNG válido.",
    400,
  );
}

export class ExternalPaymentService {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      storage: AdjuntosObjectStorage;
      bucket: string;
      maxFileBytes: number;
      pay: ReturnType<typeof createPayWorkflow>;
    },
  ) {}

  private async authorize(user: AuthUser) {
    const owner = user.workflowOwnerId
      ? await this.deps.db.workflowOwner.findUnique({
          where: { id: user.workflowOwnerId },
        })
      : null;
    if (
      user.state !== 1 ||
      (!user.isSystemAdmin &&
        (!owner?.isActive || !["TESORERIA", "RIESGO"].includes(owner.code)))
    )
      fail(
        "FORBIDDEN_EXTERNAL_PAYMENT",
        "Solo Tesorería, Riesgo o un administrador pueden registrar pagos externos.",
        403,
      );
  }

  private async source(db: Db, id: string) {
    const source = await db.solicitud.findUnique({ where: { id }, include });
    if (!source) return fail("NOT_FOUND", "Solicitud no encontrada.", 404);
    return source;
  }

  private blocked(source: Source): string | null {
    if (source.pagoExterno)
      return "La transferencia externa ya fue registrada.";
    if (
      source.archivedAt ||
      source.estadoActual.code !== "Transferir" ||
      !source.estadoActual.isActive ||
      !source.estadoActual.owner.isActive ||
      source.estadoActual.owner.code !== "TESORERIA"
    )
      return "La solicitud debe estar en Transferir / Tesorería.";
    const order = source.desembolso;
    if (
      order &&
      (order.completedAt ||
        order.bankStartedAt ||
        order.pagos.some((p) => p.confirmedAt))
    )
      return "La reserva tiene un pago iniciado o confirmado. Requiere conciliación antes de registrar un pago externo.";
    return null;
  }

  private result(source: Source) {
    const payment = source.pagoExterno;
    const blockedReason = this.blocked(source);
    return {
      canRegister: !blockedReason,
      blockedReason,
      reservationPending: Boolean(
        source.desembolso && !source.desembolso.completedAt,
      ),
      payment: payment
        ? {
            id: payment.id,
            paidOn: payment.paidOn.toISOString().slice(0, 10),
            reference: payment.reference,
            comment: payment.comment,
            adjuntoId: payment.adjuntoId,
            recordedAt: payment.recordedAt,
            recordedBy:
              [
                payment.recordedByUser.firstName,
                payment.recordedByUser.lastName,
              ]
                .filter(Boolean)
                .join(" ") || payment.recordedByUser.legacyUser,
          }
        : null,
    };
  }

  async view(id: string, user: AuthUser) {
    await this.authorize(user);
    return this.result(await this.source(this.deps.db, id));
  }

  async register(
    id: string,
    user: AuthUser,
    raw: ExternalPaymentInput,
    body: Buffer,
  ) {
    await this.authorize(user);
    const input = externalPaymentInput.parse(raw);
    if (input.paidOn > argentinaToday())
      fail(
        "INVALID_PAYMENT_DATE",
        "La fecha del pago no puede ser futura.",
        400,
      );
    if (!body.length || body.length > this.deps.maxFileBytes)
      fail(
        "INVALID_RECEIPT_SIZE",
        "El comprobante supera el tamaño permitido o está vacío.",
        413,
      );
    const format = receiptFormat(body);
    const sha256 = hash(body);
    const replay = (source: Source) => {
      const prior = source.pagoExterno!;
      if (
        prior.id !== input.requestId ||
        prior.receiptSha256 !== sha256 ||
        prior.reference !== input.reference ||
        prior.paidOn.toISOString().slice(0, 10) !== input.paidOn ||
        (prior.comment ?? "") !== input.comment
      )
        fail(
          "EXTERNAL_PAYMENT_CONFLICT",
          "La solicitud ya tiene otro pago externo registrado.",
        );
      return this.result(source);
    };
    const source = await this.source(this.deps.db, id);
    if (source.pagoExterno) return replay(source);
    const blockedReason = this.blocked(source);
    if (blockedReason) fail("EXTERNAL_PAYMENT_BLOCKED", blockedReason);
    const key = `solicitudes/${id}/pagos-externos/${input.requestId}/${sha256}.${format.extension}`;
    await this.deps.storage.uploadObject({
      bucket: this.deps.bucket,
      key,
      body,
      contentType: format.mime,
    });
    return this.deps.db
      .$transaction(
        async (tx) => {
          // Same parent -> reservation lock order as reservation/receipt/revalidation.
          await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM transferencia_desembolsos WHERE solicitud_id = ${id}::uuid FOR UPDATE`;
          const current = await this.source(tx, id);
          if (current.pagoExterno) return replay(current);
          const reason = this.blocked(current);
          if (reason) fail("EXTERNAL_PAYMENT_BLOCKED", reason);
          const rule = await tx.solicitudFieldAccessRule.findFirst({
            where: {
              workflowStateId: current.estadoActualId,
              active: true,
              canManageAttachments: true,
            },
          });
          if (!rule)
            fail(
              "ATTACHMENTS_FORBIDDEN",
              "El estado no permite adjuntar comprobantes.",
              403,
            );
          const adjunto = await tx.solicitudAdjunto.create({
            data: {
              solicitudId: id,
              archivoNombre: `pago-externo-${input.paidOn}.${format.extension}`,
              archivoPath: key,
              storageBucket: this.deps.bucket,
              archivoMimeType: format.mime,
              archivoSizeBytes: body.length,
              tipoAdjunto: "Comprobante de transferencia",
              descripcion: `Transferencia realizada por fuera. Referencia: ${input.reference}`,
              uploadedBy: user.id,
            },
          });
          await tx.solicitudPagoExterno.create({
            data: {
              id: input.requestId,
              solicitudId: id,
              desembolsoId: current.desembolso?.id,
              paidOn: new Date(`${input.paidOn}T00:00:00Z`),
              reference: input.reference,
              comment: input.comment || null,
              receiptSha256: sha256,
              adjuntoId: adjunto.id,
              recordedBy: user.id,
            },
          });
          if (current.desembolso)
            await tx.$queryRaw`SELECT set_config('beex.transferencias_desembolso', ${current.desembolso.id}, true)`;
          await this.deps.pay(
            tx,
            id,
            {
              id: user.id,
              workflowOwnerId: user.workflowOwnerId ?? "",
              clientId: "beex-external-payment",
              isSystemAdmin: user.isSystemAdmin,
            },
            `Transferencia realizada por fuera. Fecha: ${input.paidOn}. Referencia: ${input.reference}.${input.comment ? ` Comentario: ${input.comment}` : ""}`,
          );
          const paid = await tx.solicitud.findUniqueOrThrow({
            where: { id },
            select: { estadoActual: { select: { code: true } } },
          });
          if (paid.estadoActual.code !== "Pagada")
            fail("WORKFLOW_CONFLICT", "El workflow no finalizó en Pagada.");
          if (current.desembolso)
            await tx.transferenciaDesembolso.update({
              where: { id: current.desembolso.id },
              data: { completedAt: new Date() },
            });
          return this.result(await this.source(tx, id));
        },
        { timeout: 15000 },
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          fail(
            "EXTERNAL_PAYMENT_CONFLICT",
            "El identificador ya fue usado para otro registro de pago externo.",
          );
        throw error;
      });
  }
}
