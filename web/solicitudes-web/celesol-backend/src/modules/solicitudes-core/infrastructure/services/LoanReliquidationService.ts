import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import { actingContext } from "../../../auth/impersonation/context";
import { administrativeSource } from "./AdministrativeCorrectionService";
import type { CoreLoanLifecycle } from "./ControlledLoanReplacementService";
import { AdministrativeCorrectionError, assertNoLoanReplacementPending } from "../../domain/workflow/AdministrativeCorrection";
import { RELIQUIDATION_ACTION, assertReliquidationCancellation, reliquidation } from "../../domain/workflow/LoanReliquidation";

type Source = Awaited<ReturnType<typeof administrativeSource>>;
type Input = { requestId: string; expectedUpdatedAt: string; previousLoanId: string; reason: string };
const json = (v: unknown): Prisma.InputJsonObject => JSON.parse(JSON.stringify(v));
type Hold = { requestId: string; previousLoanId: string; reason: string };
const hold = (s: Source) => (s.administrativeCoreControl as Prisma.JsonObject | null)?.reliquidationHold as Hold | undefined;

/** First version deliberately rejects every reservation and refinancing record. */
export async function assertReliquidationFinanciallyClear(db: Prisma.TransactionClient, s: Source) {
  assertNoLoanReplacementPending(s);
  if (s.desembolso || s.pagoExterno)
    throw new AdministrativeCorrectionError("Reliquidación bloqueada: existe una reserva de transferencia o un pago. Esta versión no cancela reservas.");
  if (await db.solicitudEstadoHistorial.findFirst({ where: { solicitudId: s.id, toStateCodeSnapshot: "Pagada" }, select: { id: true } }))
    throw new AdministrativeCorrectionError("Reliquidación bloqueada: la solicitud tiene antecedentes de pago.");
  if (await db.solicitudRefinanciacion.findFirst({ where: { solicitudId: s.id }, select: { id: true } }))
    throw new AdministrativeCorrectionError("Reliquidación bloqueada: hay refinanciación registrada. Requiere conciliación específica.");
  if (await db.solicitudPrestamoReplacement.findFirst({ where: { solicitudId: s.id, status: { not: "LINKED" } }, select: { id: true } }))
    throw new AdministrativeCorrectionError("Reliquidación bloqueada: hay un reemplazo de préstamo pendiente o incierto.");
}

export class LoanReliquidationService {
  constructor(private readonly deps: {
    db: PrismaClient;
    lifecycle: (id: string, direct?: boolean) => Promise<CoreLoanLifecycle | null>;
  }) {}

  private async actor(db: Prisma.TransactionClient, s: Source, user: AuthUser) {
    // Do not grant new cross-area permissions through an impersonated identity.
    if (actingContext.getStore()) throw new AdministrativeCorrectionError("Usá tu propia sesión para confirmar la anulación.", 403);
    const actor = await db.user.findFirst({ where: { id: user.id, state: 1, deletedAt: null }, include: { workflowOwner: true } });
    if (!actor || (!actor.isSystemAdmin && (!actor.workflowOwner?.isActive || actor.workflowOwnerId !== s.estadoActual.ownerId)))
      throw new AdministrativeCorrectionError("Sólo el área a cargo de Legajos o Tesorería puede devolver esta solicitud a Riesgo.", 403);
    return actor;
  }

  private async eligible(db: Prisma.TransactionClient, s: Source, user: AuthUser) {
    const actor = await this.actor(db, s, user);
    if (s.archivedAt || !s.estadoActual.isActive || !s.estadoActual.owner.isActive || !s.legacyOid ||
      !((s.estadoActual.code === "VerificarFirmaYDocumentacion" && s.estadoActual.owner.code === "LEGAJOS_DIGITALES") ||
        (s.estadoActual.code === "Transferir" && s.estadoActual.owner.code === "TESORERIA")))
      throw new AdministrativeCorrectionError("La devolución por anulación sólo está habilitada en Legajos o Transferir, con un préstamo vinculado.");
    const control = { ...(s.administrativeCoreControl as Prisma.JsonObject | null) };
    delete control.reliquidationHold;
    await assertReliquidationFinanciallyClear(db, { ...s, administrativeCoreControl: control });
    const analyst = s.assignedToUserId && await db.user.findFirst({ where: {
      id: s.assignedToUserId, state: 1, deletedAt: null, workflowOwner: { code: "RIESGO", isActive: true },
    }, select: { id: true } });
    if (!analyst) throw new AdministrativeCorrectionError("Asigná un analista activo de Riesgo antes de devolver la solicitud.");
    return actor;
  }

  async view(id: string, user: AuthUser) {
    const s = await administrativeSource(this.deps.db, id);
    const r = reliquidation(s.administrativeCoreControl);
    const pending = Boolean(r?.status === "AWAITING_LOAN" && !s.legacyOid);
    const visible = pending || ["VerificarFirmaYDocumentacion", "Transferir"].includes(s.estadoActual.code);
    let blockedReason: string | null = null;
    try { await this.eligible(this.deps.db, s, user); }
    catch (e) { if (!(e instanceof AdministrativeCorrectionError)) throw e; blockedReason = e.message; }
    return { visible, pending, prepared: Boolean(hold(s)), requestId: hold(s)?.requestId,
      reason: hold(s)?.reason, canReopen: !blockedReason, blockedReason,
      updatedAt: s.updatedAt.toISOString(), previousLoanId: pending ? r!.previousLoanId : s.legacyOid };
  }

  async prepare(id: string, user: AuthUser, input: Input) {
    await this.deps.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      const s = await administrativeSource(tx, id);
      const actor = await this.eligible(tx, s, user);
      const previous = hold(s);
      if (previous?.requestId === input.requestId && previous.previousLoanId === input.previousLoanId && previous.reason === input.reason.trim()) return;
      if (previous || s.updatedAt.toISOString() !== input.expectedUpdatedAt || s.legacyOid !== input.previousLoanId)
        throw new AdministrativeCorrectionError("La solicitud cambió o ya tiene una preparación pendiente. Actualizá el detalle.");
      await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: {
        ...(s.administrativeCoreControl as Prisma.JsonObject | null),
        reliquidationHold: { requestId: input.requestId, previousLoanId: input.previousLoanId,
          reason: input.reason.trim(), startedAt: new Date().toISOString(), actorId: actor.id },
      } } });
      await tx.solicitudEstadoHistorial.create({ data: {
        solicitudId: id, estadoAnteriorId: s.estadoActualId, estadoNuevoId: s.estadoActualId,
        fromStateCodeSnapshot: s.estadoActual.code, toStateCodeSnapshot: s.estadoActual.code,
        fromStateNameSnapshot: s.estadoActual.name, toStateNameSnapshot: s.estadoActual.name,
        fromOwnerIdSnapshot: s.estadoActual.ownerId, toOwnerIdSnapshot: s.estadoActual.ownerId,
        fromOwnerCodeSnapshot: s.estadoActual.owner.code, toOwnerCodeSnapshot: s.estadoActual.owner.code,
        actionCode: "RELIQUIDATION_PREPARED", actionLabel: "Solicitud pausada para reliquidación",
        changedBy: actor.id, realActorUserId: actor.id, comentario: input.reason.trim(),
        metadata: { requestId: input.requestId, previousLoanId: input.previousLoanId },
      } });
    });
    return this.view(id, user);
  }

  private async replay(db: Prisma.TransactionClient, id: string, user: AuthUser, input: Input) {
    const h = await db.solicitudEstadoHistorial.findUnique({ where: { id: input.requestId } });
    if (!h) return false;
    const metadata = h.metadata as Record<string, unknown> | null;
    if (h.solicitudId !== id || h.actionCode !== RELIQUIDATION_ACTION || h.changedBy !== user.id ||
      h.comentario !== input.reason.trim() || metadata?.previousLoanId !== input.previousLoanId)
      throw new AdministrativeCorrectionError("La clave de operación ya fue usada con otros datos.");
    return true;
  }

  async reopen(id: string, user: AuthUser, input: Input) {
    if (actingContext.getStore()) throw new AdministrativeCorrectionError("Usá tu propia sesión para confirmar la anulación.", 403);
    if (await this.replay(this.deps.db, id, user, input)) return this.view(id, user);
    const before = await administrativeSource(this.deps.db, id);
    await this.eligible(this.deps.db, before, user);
    const preparation = hold(before);
    if (!preparation || preparation.requestId !== input.requestId || preparation.previousLoanId !== input.previousLoanId || preparation.reason !== input.reason.trim())
      throw new AdministrativeCorrectionError("Primero prepará la reliquidación en Beex para pausar firma y transferencias.");
    if (before.updatedAt.toISOString() !== input.expectedUpdatedAt || before.legacyOid !== input.previousLoanId)
      throw new AdministrativeCorrectionError("La solicitud cambió. Actualizá y revisá el préstamo antes de confirmar.");
    const c = before.administrativeCoreControl as Prisma.JsonObject | null;
    const loan = await this.deps.lifecycle(input.previousLoanId, Boolean(c?.generatedLoanId || c?.replacementId));
    assertReliquidationCancellation(loan);
    await this.deps.db.$transaction(async tx => {
      // Same parent lock used by reservation, bank authorization and state changes.
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      if (await this.replay(tx, id, user, input)) return;
      const s = await administrativeSource(tx, id);
      const actor = await this.eligible(tx, s, user);
      if (s.updatedAt.toISOString() !== input.expectedUpdatedAt || s.legacyOid !== input.previousLoanId)
        throw new AdministrativeCorrectionError("La solicitud cambió durante la consulta a Vimarx. Actualizá antes de continuar.");
      if (hold(s)?.requestId !== input.requestId) throw new AdministrativeCorrectionError("La preparación de reliquidación cambió.");
      const target = await tx.workflowState.findUnique({ where: { code: "RevisionRiesgo" }, include: { owner: true } });
      if (!target?.isActive || target.owner.code !== "RIESGO" || !target.owner.isActive)
        throw new AdministrativeCorrectionError("Revisión Riesgo no está disponible.");
      const now = new Date();
      await tx.solicitudEstadoHistorial.create({ data: {
        id: input.requestId, solicitudId: id, estadoAnteriorId: s.estadoActualId, estadoNuevoId: target.id,
        fromStateCodeSnapshot: s.estadoActual.code, fromStateNameSnapshot: s.estadoActual.name,
        fromOwnerIdSnapshot: s.estadoActual.ownerId, fromOwnerCodeSnapshot: s.estadoActual.owner.code,
        fromOwnerNameSnapshot: s.estadoActual.owner.name,
        toStateCodeSnapshot: target.code, toStateNameSnapshot: target.name,
        toOwnerIdSnapshot: target.ownerId, toOwnerCodeSnapshot: target.owner.code, toOwnerNameSnapshot: target.owner.name,
        actionCode: RELIQUIDATION_ACTION, actionLabel: "Anulación confirmada; devuelta a Riesgo",
        changedBy: actor.id, realActorUserId: actor.id, changedAt: now,
        comentario: input.reason.trim(), motivo: "RELIQUIDATION", requiresComment: true,
        metadata: json({ previousLoanId: s.legacyOid, verifiedCancellation: loan, paymentValidationSource: "BEEX",
          previousSignatureLink: s.linkFirmaDigital, previousSignatureCycle: s.signatureCycleId,
          previousCoreControl: s.administrativeCoreControl,
          previousAnalysisFinishedAt: s.analisisFinalizadoAt, assignedToUserId: s.assignedToUserId }),
      } });
      await tx.solicitud.update({ where: { id }, data: {
        estadoActualId: target.id, legacyOid: null, linkFirmaDigital: null,
        analisisFinalizadoAt: null, analisisFinalizadoBy: null,
        signatureCycleId: randomUUID(), signatureRequestedAt: null, signatureRequestReason: null,
        signatureExcludedVerificationIds: Prisma.DbNull,
        // Previous control remains in the history. A new generation owns a new control.
        administrativeCoreControl: { loanId: null, reconciledFingerprint: null, reliquidation: {
          requestId: input.requestId, previousLoanId: s.legacyOid!, resolvedLoanId: loan!.id!,
          reopenedAt: now.toISOString(), status: "AWAITING_LOAN",
        } },
      } });
    });
    return this.view(id, user);
  }
}
