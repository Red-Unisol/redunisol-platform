import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import { actingContext } from "../../../auth/impersonation/context";
import type { ChangeSolicitudStateUseCase } from "../../application/use-cases/ChangeSolicitudState.use-case";
import type { LineaPrestamoLegacyIdResolver } from "../../domain/services/LineaPrestamoLegacyIdResolver";
import {
  ADMIN_CORRECTION_ACTION, AdministrativeCorrectionError, coreConditionsFingerprint,
  coreReconciliationPending, assertNoLoanReplacementPending,
} from "../../domain/workflow/AdministrativeCorrection";
import type { WorkflowCommand } from "../../domain/workflow/types";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";

export const administrativeInclude = {
  estadoActual: { include: { owner: true } }, titular: true,
  cancelaciones: true, desembolso: true, pagoExterno: true,
} satisfies Prisma.SolicitudInclude;
type Source = Prisma.SolicitudGetPayload<{ include: typeof administrativeInclude }>;

export function assertAdministrativeActor(user: { isSystemAdmin?: boolean }) {
  if (!user.isSystemAdmin || actingContext.getStore())
    throw new AdministrativeCorrectionError("Esta acción requiere tu propia sesión de administrador.", 403);
}

export async function administrativeSource(db: Prisma.TransactionClient, id: string) {
  const s = await db.solicitud.findUnique({ where: { id }, include: administrativeInclude });
  if (!s) throw new SolicitudCoreNotFoundError();
  return s;
}

export async function correctionBlockedReason(db: Prisma.TransactionClient, s: Source) {
  if ((s.administrativeCoreControl as Record<string, unknown> | null)?.replacementPending)
    return "Hay un reemplazo de préstamo en curso o con resultado incierto.";
  if (s.archivedAt || s.estadoActual.code !== "Confirmada")
    return "La corrección habilitada es Confirmada → Revisar, en solicitudes no archivadas.";
  if (s.desembolso || s.pagoExterno)
    return "La solicitud tiene una reserva de desembolso o un pago registrado.";
  const downstream = await db.solicitudEstadoHistorial.findFirst({
    where: { solicitudId: s.id, toStateCodeSnapshot: { in: ["Liquidada", "VerificarFirmaYDocumentacion", "Transferir", "Pagada"] } },
    select: { id: true },
  });
  return downstream ? "La solicitud ya recorrió etapas de liquidación o pago y requiere una intervención específica." : null;
}

export async function applyAdministrativeCorrection(db: Prisma.TransactionClient, command: WorkflowCommand) {
  assertAdministrativeActor(command);
  const correction = command.administrativeCorrection;
  if (command.actionCode !== ADMIN_CORRECTION_ACTION || !correction || !command.comment?.trim())
    throw new AdministrativeCorrectionError("Corrección administrativa incompleta.", 400);
  const actor = await db.user.findFirst({ where: { id: command.changedBy, isSystemAdmin: true, state: 1, deletedAt: null } });
  if (!actor) throw new AdministrativeCorrectionError("Se requiere un administrador activo.", 403);
  await db.$queryRaw`SELECT id FROM solicitudes WHERE id = ${command.solicitudId}::uuid FOR UPDATE`;
  const s = await administrativeSource(db, command.solicitudId);
  if (s.updatedAt.toISOString() !== correction.expectedUpdatedAt)
    throw new AdministrativeCorrectionError("La solicitud cambió. Actualizá el detalle antes de corregirla.");
  assertNoLoanReplacementPending(s);
  const blocked = await correctionBlockedReason(db, s);
  if (blocked) throw new AdministrativeCorrectionError(blocked);
  const target = await db.workflowState.findUnique({ where: { code: "Revisar" }, include: { owner: true } });
  if (!target?.isActive) throw new AdministrativeCorrectionError("El estado Revisar no está activo.");
  await db.solicitud.update({
    where: { id: s.id },
    data: {
      estadoActualId: target.id,
      montoAprobadoRiesgo: s.montoAFinanciar,
      ...(s.legacyOid ? { administrativeCoreControl: {
        correctionId: correction.requestId, loanId: s.legacyOid,
        correctedAt: command.now.toISOString(), reconciledFingerprint: null,
      } } : {}),
    },
  });
  await db.solicitudEstadoHistorial.create({ data: {
    id: correction.requestId, solicitudId: s.id, transitionId: null,
    estadoAnteriorId: s.estadoActualId, estadoNuevoId: target.id,
    fromStateCodeSnapshot: s.estadoActual.code, fromStateNameSnapshot: s.estadoActual.name,
    fromOwnerIdSnapshot: s.estadoActual.owner.id, fromOwnerCodeSnapshot: s.estadoActual.owner.code,
    fromOwnerNameSnapshot: s.estadoActual.owner.name,
    toStateCodeSnapshot: target.code, toStateNameSnapshot: target.name,
    toOwnerIdSnapshot: target.owner.id, toOwnerCodeSnapshot: target.owner.code, toOwnerNameSnapshot: target.owner.name,
    actionCode: ADMIN_CORRECTION_ACTION, actionLabel: "Corrección administrativa de estado",
    changedBy: actor.id, realActorUserId: actor.id, changedAt: command.now,
    comentario: command.comment.trim(), motivo: "ADMINISTRATIVE_CORRECTION",
    requiresComment: true, saveAndExit: false,
    metadata: { correctionId: correction.requestId, legacyOid: s.legacyOid,
      assignedToUserId: s.assignedToUserId, coreReconciliationRequired: Boolean(s.legacyOid) },
  } });
}

export type CoreLoanSnapshot = {
  estado: number | null;
  id: string; amount: number | null; cuotas: number | null; lineaId: string | null;
  primerVencimiento: string | null; cancelacionesCentavos: number | null;
};

export class AdministrativeCorrectionService {
  constructor(private readonly deps: {
    db: PrismaClient;
    changeState: Pick<ChangeSolicitudStateUseCase, "execute">;
    loanSnapshot: (loanId: string, documento: string, directLoanId?: boolean) => Promise<CoreLoanSnapshot | null>;
    lineResolver: LineaPrestamoLegacyIdResolver;
  }) {}

  async view(id: string, user: AuthUser) {
    const s = await administrativeSource(this.deps.db, id);
    const canAdmin = Boolean(user.isSystemAdmin && !actingContext.getStore());
    return {
      canAdmin, updatedAt: s.updatedAt.toISOString(), state: s.estadoActual.code,
      replacementPending: Boolean((s.administrativeCoreControl as Prisma.JsonObject | null)?.replacementPending),
      loanId: s.legacyOid, reconciliationRequired: coreReconciliationPending(s),
      blockedReason: canAdmin ? await correctionBlockedReason(this.deps.db, s) : null,
    };
  }

  async correct(id: string, user: AuthUser, input: { expectedUpdatedAt: string; requestId: string; reason: string; targetStateCode: "Revisar" }) {
    assertAdministrativeActor(user);
    await this.deps.changeState.execute({
      actionCode: ADMIN_CORRECTION_ACTION, comment: input.reason,
      administrativeCorrection: { expectedUpdatedAt: input.expectedUpdatedAt, requestId: input.requestId },
      solicitudId: id,
      currentUser: { id: user.id, isSystemAdmin: true, workflowOwnerId: user.workflowOwnerId ?? "" },
    });
    return this.view(id, user);
  }

  async reconcile(id: string, user: AuthUser, input: { expectedUpdatedAt: string; reason: string }) {
    assertAdministrativeActor(user);
    const before = await administrativeSource(this.deps.db, id);
    assertNoLoanReplacementPending(before);
    if (!before.administrativeCoreControl || !before.legacyOid || !before.titular?.nroDocumento)
      throw new AdministrativeCorrectionError("La solicitud no tiene una conciliación pendiente verificable.");
    // Read only: this operation never generates, replaces or modifies a Core loan.
    const [loan, line] = await Promise.all([
      this.deps.loanSnapshot(before.legacyOid, before.titular.nroDocumento, Boolean((before.administrativeCoreControl as Prisma.JsonObject).replacementId)),
      this.deps.lineResolver.resolveByPresolicitudOid(before.lineaPrestamoLegacyOid),
    ]);
    const cancellations = before.cancelaciones.filter(c => !c.deletedAt).reduce((v, c) => v + Number(c.monto), 0);
    if (!loan || loan.estado !== 0)
      throw new AdministrativeCorrectionError("El préstamo Core no está activo o no pudo verificarse con el titular. Un préstamo anulado requiere un reemplazo excepcional.");
    if (!line || before.montoAFinanciar === null || loan.amount === null || loan.amount <= 0 || loan.cuotas === null ||
      loan.amount !== Number(before.montoAFinanciar) || loan.cuotas !== before.cuotas ||
      loan.lineaId !== line.id ||
      (before.fechaPrimerVencimiento && loan.primerVencimiento?.slice(0, 10) !== before.fechaPrimerVencimiento.toISOString().slice(0, 10)) ||
      (loan.cancelacionesCentavos !== Math.round(cancellations * 100)))
      throw new AdministrativeCorrectionError("Las condiciones o el titular del préstamo Core no coinciden con Beex. Revisá monto, cuotas, línea, vencimiento y cancelaciones en el Core antes de conciliar.");
    await this.deps.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      const s = await administrativeSource(tx, id);
      assertNoLoanReplacementPending(s);
      if (s.updatedAt.toISOString() !== input.expectedUpdatedAt ||
        coreConditionsFingerprint(s) !== coreConditionsFingerprint(before))
        throw new AdministrativeCorrectionError("La solicitud cambió durante la verificación. Actualizá el detalle.");
      if (s.archivedAt || !["Revisar", "RevisionRiesgo", "PreAprobada", "Confirmada"].includes(s.estadoActual.code) || s.desembolso || s.pagoExterno)
        throw new AdministrativeCorrectionError("La solicitud no admite conciliación en su estado actual.");
      const actor = await tx.user.findFirst({ where: { id: user.id, isSystemAdmin: true, state: 1, deletedAt: null } });
      if (!actor) throw new AdministrativeCorrectionError("Se requiere un administrador activo.", 403);
      const control = s.administrativeCoreControl as Prisma.JsonObject;
      await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: {
        ...control, reconciledFingerprint: coreConditionsFingerprint(s),
        reconciledAt: new Date().toISOString(), reconciledBy: actor.id,
      } } });
      await tx.solicitudEstadoHistorial.create({ data: {
        solicitudId: id, estadoAnteriorId: s.estadoActualId, estadoNuevoId: s.estadoActualId,
        fromStateCodeSnapshot: s.estadoActual.code, toStateCodeSnapshot: s.estadoActual.code,
        fromStateNameSnapshot: s.estadoActual.name, toStateNameSnapshot: s.estadoActual.name,
        fromOwnerIdSnapshot: s.estadoActual.owner.id, toOwnerIdSnapshot: s.estadoActual.owner.id,
        fromOwnerCodeSnapshot: s.estadoActual.owner.code, toOwnerCodeSnapshot: s.estadoActual.owner.code,
        fromOwnerNameSnapshot: s.estadoActual.owner.name, toOwnerNameSnapshot: s.estadoActual.owner.name,
        actionCode: "ADMIN_CORE_RECONCILIATION", actionLabel: "Conciliación de préstamo Core",
        changedBy: actor.id, realActorUserId: actor.id, comentario: input.reason,
        motivo: "ADMIN_CORE_RECONCILIATION", requiresComment: true,
        metadata: { loanId: s.legacyOid, verifiedLoan: loan },
      } });
    });
    return this.view(id, user);
  }
}
