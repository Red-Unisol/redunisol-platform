import { Prisma, type PrismaClient } from "@prisma/client";
import type { AdjuntosObjectStorage } from "../solicitudes-core/adjuntos/domain/services/AdjuntosObjectStorage";
import {
  buildPlan,
  digest,
  fail,
  hash,
  type Actor,
  type Confirmation,
  type FinancialGateway,
  type PaymentPlan,
  type ReservationInput,
} from "./domain";

const sourceSelect = {
  id: true,
  nroSolicitud: true,
  legacyOid: true,
  montoAFinanciar: true,
  firmaDigitalmente: true,
  archivedAt: true,
  estadoActual: {
    select: {
      code: true,
      isActive: true,
      owner: { select: { code: true, isActive: true } },
    },
  },
  titular: {
    select: {
      cbu: true,
      cbuNoHabitual: true,
      cuit: true,
      nroDocumento: true,
      nombre: true,
      apellidoDenominacion: true,
    },
  },
  cancelaciones: {
    where: { deletedAt: null },
    orderBy: { id: "asc" as const },
    select: {
      id: true,
      monto: true,
      cbu: true,
      socio: true,
      socioLegacyId: true,
    },
  },
} satisfies Prisma.SolicitudSelect;
const orderInclude = {
  pagos: { orderBy: { paymentKey: "asc" as const } },
} as const;
type Order = Prisma.TransferenciaDesembolsoGetPayload<{
  include: typeof orderInclude;
}>;
type Db = PrismaClient | Prisma.TransactionClient;
type Dependencies = {
  db: PrismaClient;
  financials: FinancialGateway;
  storage: AdjuntosObjectStorage;
  bucket: string;
  pay: (
    tx: Prisma.TransactionClient,
    solicitudId: string,
    actor: Actor,
    comment: string,
  ) => Promise<void>;
};

export class TransferenciasService {
  constructor(private readonly deps: Dependencies) {}

  async list(limit: number, cursor?: string) {
    const rows = await this.deps.db.solicitud.findMany({
      where: {
        archivedAt: null,
        estadoActual: {
          code: "Transferir",
          isActive: true,
          owner: { code: "TESORERIA", isActive: true },
        },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        nroSolicitud: true,
        legacyOid: true,
        titular: {
          select: {
            nombre: true,
            apellidoDenominacion: true,
            nroDocumento: true,
          },
        },
        desembolso: { select: { id: true, completedAt: true } },
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map(({ id, legacyOid, ...rest }) => ({
      source: "BEEX",
      solicitudId: id,
      prestamoLegacyId: legacyOid,
      ...rest,
    }));
    return {
      items,
      nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
    };
  }

  private async source(db: Db, id: string) {
    const source = await db.solicitud.findUnique({
      where: { id },
      select: sourceSelect,
    });
    if (!source) return fail("NOT_FOUND", "Solicitud no encontrada.", 404);
    if (
      source.archivedAt ||
      source.estadoActual.code !== "Transferir" ||
      !source.estadoActual.isActive ||
      source.estadoActual.owner.code !== "TESORERIA" ||
      !source.estadoActual.owner.isActive
    )
      fail(
        "NOT_PAYABLE",
        "La solicitud debe estar activa en Transferir / TESORERIA.",
      );
    return source;
  }

  private async currentPlan(id: string) {
    const source = await this.source(this.deps.db, id);
    if (!source.legacyOid || !source.titular?.cuit)
      return fail("INCOMPLETE_PLAN", "Falta préstamo o CUIT del titular.");
    const cuit = source.titular.cuit.replace(/[-.\s]/g, "");
    const socio = await this.deps.db.socio.findUnique({ where: { cuit } });
    if (!socio?.nroSocioLegacy)
      return fail(
        "INCOMPLETE_PLAN",
        "El titular no tiene un socio vinculado al core.",
      );
    const loan = await this.deps.financials.loan(
      source.legacyOid,
      socio.nroSocioLegacy,
    );
    const creditors = new Map<string, string>();
    for (const cancellation of source.cancelaciones) {
      if (!cancellation.socioLegacyId)
        return fail(
          "INCOMPLETE_PLAN",
          "Una cancelación no tiene socio acreedor vinculado.",
        );
      const creditor = await this.deps.financials.creditor(
        cancellation.socioLegacyId,
      );
      creditors.set(cancellation.id, creditor.cuit);
    }
    return {
      plan: buildPlan(source, loan, creditors),
      sourceVersion: digest(source),
    };
  }

  async plan(id: string) {
    return (await this.currentPlan(id)).plan;
  }

  private async order(db: Db, id: string, actor: Actor): Promise<Order> {
    const order = await db.transferenciaDesembolso.findUnique({
      where: { id },
      include: orderInclude,
    });
    if (!order || order.clientId !== actor.clientId)
      return fail("NOT_FOUND", "Desembolso no encontrado.", 404);
    return order;
  }
  private view(order: Order) {
    return {
      id: order.id,
      source: "BEEX",
      solicitudId: order.solicitudId,
      prestamoLegacyId: order.prestamoLegacyId,
      plan: order.plan,
      verificationId: order.verificationId,
      status: order.completedAt
        ? "COMPLETED"
        : order.pagos.every((p) => p.confirmedAt)
          ? "BANK_CONFIRMED_PENDING_SYNC"
          : "RESERVED",
      createdAt: order.createdAt,
      completedAt: order.completedAt,
      installationId: order.installationId,
      operator: order.operator,
      receipt: order.receiptAdjuntoId
        ? { adjuntoId: order.receiptAdjuntoId, sha256: order.receiptSha256 }
        : null,
      payments: order.pagos.map((p) => ({
        paymentKey: p.paymentKey,
        bankTransactionId: p.bankTransactionId,
        bankOperationId: p.bankOperationId,
        confirmedAt: p.confirmedAt,
        confirmation: p.confirmedPayload,
      })),
    };
  }
  async get(id: string, actor: Actor) {
    return this.view(await this.order(this.deps.db, id, actor));
  }
  // Exact key lookup makes a lost reservation response recoverable after restart.
  async byKey(key: string, actor: Actor) {
    const found = await this.deps.db.transferenciaDesembolso.findUnique({
      where: { idempotencyKey: key },
    });
    if (!found) return fail("NOT_FOUND", "Reserva no encontrada.", 404);
    return this.get(found.id, actor);
  }

  async reserve(id: string, input: ReservationInput, actor: Actor) {
    const normalized = {
      ...input,
      payments: [...input.payments].sort((a, b) =>
        a.paymentKey.localeCompare(b.paymentKey),
      ),
    };
    const reservationHash = digest({
      solicitudId: id,
      clientId: actor.clientId,
      input: normalized,
    });
    const replay = (order: Order) => {
      if (order.reservationHash !== reservationHash)
        fail("IDEMPOTENCY_CONFLICT", "La clave ya fue usada con otra reserva.");
      return this.view(order);
    };
    const prior = await this.deps.db.transferenciaDesembolso.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: orderInclude,
    });
    if (prior) return replay(prior);
    const { plan, sourceVersion } = await this.currentPlan(id);
    if (plan.version !== input.planVersion)
      fail("PLAN_CHANGED", "El plan cambió; volver a consultarlo.");
    if (plan.verification.required && !input.verificationId)
      fail(
        "VERIFICATION_REQUIRED",
        "Debe vincularse la verificación digital elegida.",
      );
    if (
      new Set(input.payments.map((p) => p.paymentKey)).size !==
        input.payments.length ||
      new Set(input.payments.map((p) => p.bankTransactionId)).size !==
        input.payments.length ||
      digest(normalized.payments.map((p) => p.paymentKey)) !==
        digest(plan.payments.map((p) => p.paymentKey).sort())
    )
      fail(
        "PAYMENTS_MISMATCH",
        "La reserva debe identificar exactamente los pagos del plan.",
      );
    try {
      return await this.deps.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
        const existing = await tx.transferenciaDesembolso.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: orderInclude,
        });
        if (existing) return replay(existing);
        if (digest(await this.source(tx, id)) !== sourceVersion)
          fail("PLAN_CHANGED", "Los datos BEEX cambiaron durante la reserva.");
        const order = await tx.transferenciaDesembolso.create({
          data: {
            solicitudId: id,
            prestamoLegacyId: plan.prestamoLegacyId,
            idempotencyKey: input.idempotencyKey,
            reservationHash,
            planVersion: plan.version,
            plan,
            clientId: actor.clientId,
            installationId: input.installationId,
            operator: input.operator,
            verificationId: input.verificationId,
            pagos: { create: normalized.payments },
          },
          include: orderInclude,
        });
        return this.view(order);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        fail(
          "RESERVATION_CONFLICT",
          "Ya existe una reserva para esa solicitud, préstamo o identificador bancario.",
        );
      throw error;
    }
  }

  // Required before initiating an unconfirmed leg; never authorizes a second bank ID.
  async revalidate(id: string, actor: Actor) {
    const order = await this.order(this.deps.db, id, actor);
    if (order.completedAt)
      fail("ALREADY_COMPLETED", "El desembolso ya fue completado.");
    const plan = await this.plan(order.solicitudId);
    if (plan.version !== order.planVersion)
      fail(
        "PLAN_CHANGED",
        "Cambió el plan financiero. Conciliar cualquier pago iniciado antes de continuar.",
      );
    return { planVersion: plan.version, checkedAt: new Date(), valid: true };
  }

  async confirm(
    id: string,
    paymentKey: string,
    input: Confirmation,
    actor: Actor,
  ) {
    try {
      return await this.deps.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM transferencia_desembolsos WHERE id = ${id}::uuid FOR UPDATE`;
        const order = await this.order(tx, id, actor);
        const payment = order.pagos.find((p) => p.paymentKey === paymentKey);
        const leg = (order.plan as unknown as PaymentPlan).payments.find(
          (p) => p.paymentKey === paymentKey,
        );
        if (!payment || !leg)
          return fail("NOT_FOUND", "Pago no encontrado.", 404);
        if (
          payment.bankTransactionId !== input.bankTransactionId ||
          leg.amount !== input.amount ||
          leg.cbu !== input.cbu ||
          leg.cuit !== input.cuit
        )
          fail(
            "CONFIRMATION_MISMATCH",
            "El resultado bancario no coincide con el pago reservado.",
          );
        if (new Date(input.confirmedAt).getTime() > Date.now() + 60_000)
          fail(
            "INVALID_CONFIRMATION_TIME",
            "La fecha bancaria no puede estar en el futuro.",
            400,
          );
        if (payment.confirmedAt) {
          // Metadata may change on recovery; the financial evidence must remain identical.
          const prior = payment.confirmedPayload as unknown as Confirmation;
          const financial = ({
            installationId: _i,
            operator: _o,
            ...value
          }: Confirmation) => ({
            ...value,
            confirmedAt: new Date(value.confirmedAt).toISOString(),
          });
          if (digest(financial(prior)) !== digest(financial(input)))
            fail(
              "CONFIRMATION_CONFLICT",
              "El pago ya tiene otro resultado confirmado.",
            );
          return this.view(order);
        }
        await tx.transferenciaPago.update({
          where: { id: payment.id },
          data: {
            bankOperationId: input.bankOperationId,
            confirmedAt: new Date(input.confirmedAt),
            confirmedPayload: input,
          },
        });
        return this.view(await this.order(tx, id, actor));
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        fail(
          "BANK_OPERATION_CONFLICT",
          "La operación bancaria ya está vinculada a otro pago.",
        );
      throw error;
    }
  }

  async receipt(id: string, body: Buffer, actor: Actor) {
    // MIME and filename alone are untrusted; PDFs are bounded by the router as well.
    if (
      !body.subarray(0, 5).equals(Buffer.from("%PDF-")) ||
      !body
        .subarray(Math.max(0, body.length - 1024))
        .includes(Buffer.from("%%EOF"))
    )
      fail("INVALID_PDF", "El comprobante debe ser un PDF.", 400);
    const sha256 = hash(body);
    const initial = await this.order(this.deps.db, id, actor);
    const completed = (order: Order) => {
      if (order.receiptSha256 !== sha256)
        fail("RECEIPT_CONFLICT", "El desembolso tiene otro comprobante.");
      return this.view(order);
    };
    if (initial.completedAt) return completed(initial);
    if (!initial.pagos.every((p) => p.confirmedAt))
      fail("UNCONFIRMED_PAYMENTS", "Falta confirmar al menos un pago.");
    // Content-addressed key: concurrent different PDFs cannot overwrite the winner.
    // If the DB rolls back, retry reuses the object. Never delete on a competing retry.
    const key = `solicitudes/${initial.solicitudId}/transferencias/${id}/${sha256}.pdf`;
    await this.deps.storage.uploadObject({
      bucket: this.deps.bucket,
      key,
      body,
      contentType: "application/pdf",
    });
    return this.deps.db.$transaction(
      async (tx) => {
        // Same locking order as reservation and the financial-data freeze triggers.
        await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${initial.solicitudId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM transferencia_desembolsos WHERE id = ${id}::uuid FOR UPDATE`;
        const order = await this.order(tx, id, actor);
        if (order.completedAt) return completed(order);
        await this.source(tx, order.solicitudId);
        const rule = await tx.solicitudFieldAccessRule.findFirst({
          where: {
            workflowState: { code: "Transferir" },
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
            solicitudId: order.solicitudId,
            archivoNombre: `transferencia-${id}.pdf`,
            archivoPath: key,
            archivoMimeType: "application/pdf",
            archivoSizeBytes: body.length,
            storageBucket: this.deps.bucket,
            tipoAdjunto: "Comprobante de transferencia",
            descripcion: `Desembolso BEEX ${id}`,
            uploadedBy: actor.id,
          },
        });
        // Only this transaction may close the frozen solicitud through its normal workflow.
        await tx.$queryRaw`SELECT set_config('beex.transferencias_desembolso', ${id}, true)`;
        await this.deps.pay(
          tx,
          order.solicitudId,
          actor,
          `Transferencias: desembolso ${id}; cliente ${order.clientId}; instalación ${order.installationId}; operador ${order.operator}; PDF SHA256 ${sha256}`,
        );
        const paid = await tx.solicitud.findUnique({
          where: { id: order.solicitudId },
          select: { estadoActual: { select: { code: true } } },
        });
        if (paid?.estadoActual.code !== "Pagada")
          fail(
            "WORKFLOW_CONFLICT",
            "La transición pagar no finalizó en Pagada.",
          );
        await tx.transferenciaDesembolso.update({
          where: { id },
          data: {
            receiptAdjuntoId: adjunto.id,
            receiptSha256: sha256,
            completedAt: new Date(),
          },
        });
        return this.view(await this.order(tx, id, actor));
      },
      { timeout: 15_000 },
    );
  }
}
