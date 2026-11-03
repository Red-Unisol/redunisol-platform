import type { Prisma } from "@prisma/client";
import type { WorkflowTransition } from "../../domain/entities/WorkflowTransition.entity";
import type { WorkflowCommand } from "../../domain/workflow/types";
import { REVERSE_DISMISSAL_ACTION } from "../../domain/workflow/Dismissal";
import { AdministrativeCorrectionError, assertNoLoanReplacementPending } from "../../domain/workflow/AdministrativeCorrection";
import { ForbiddenSolicitudAccessError, SolicitudWorkflowCommentRequiredError, WorkflowExecutionPlanStateConflictError } from "../../domain/solicitudes-core-errors";
import { actingContext, actingHistoryFields } from "../../../auth/impersonation/context";
import { administrativeSource, assertAdministrativeActor } from "./AdministrativeCorrectionService";
import { fullyCancelledLoan } from "../../application/services/LinkedLoanRules";
import type { CoreLoanLifecycle } from "./ControlledLoanReplacementService";

export type DismissalLifecycle = (id: string, directLoanId?: boolean) => Promise<CoreLoanLifecycle | null>;
type Source = Awaited<ReturnType<typeof administrativeSource>>;
const LIQUIDATION_STATES = ["Liquidada", "VerificarFirmaYDocumentacion", "Transferir", "Pagada"];

async function readLifecycle(id: string, direct?: boolean) {
  const { env } = await import("../../../../config/env.js");
  const { EvaluateListSolicitudesGateway } = await import("../../../solicitudes/infrastructure/services/EvaluateListSolicitudesGateway.js");
  return new EvaluateListSolicitudesGateway({ baseUrl: env.LEGACY_API_BASE_URL, timeoutMs: env.LEGACY_API_TIMEOUT_MS })
    .getCoreLoanLifecycle(id, direct);
}

/** Runs under the workflow's source-row lock. It never writes to Vimarx. */
export async function prepareDismissal(
  db: Prisma.TransactionClient, input: { source: Source; actorId: string; comment: string | null },
  lifecycle: DismissalLifecycle = readLifecycle,
): Promise<Prisma.InputJsonObject> {
  const s = input.source;
  if (!input.comment?.trim()) throw new SolicitudWorkflowCommentRequiredError();
  const actor = await db.user.findFirst({ where: { id: input.actorId, state: 1, deletedAt: null } });
  if (!actor || (!actor.isSystemAdmin && actor.workflowOwnerId !== s.estadoActual.ownerId))
    throw new ForbiddenSolicitudAccessError();
  assertNoLoanReplacementPending(s);
  if (s.archivedAt || s.estadoActual.code === "Desestimada")
    throw new AdministrativeCorrectionError("La solicitud archivada o ya desestimada no admite otra desestimación.");
  if (s.desembolso || s.pagoExterno)
    throw new AdministrativeCorrectionError("Resolvé la reserva de transferencia o el pago registrado antes de desestimar. La anulación en Vimarx no revierte el movimiento bancario.");
  if (!s.legacyOid) {
    const liquidatedBefore = await db.solicitudEstadoHistorial.findFirst({
      where: { solicitudId: s.id, toStateCodeSnapshot: { in: LIQUIDATION_STATES } },
      select: { id: true },
    });
    if (LIQUIDATION_STATES.includes(s.estadoActual.code) || liquidatedBefore)
      throw new AdministrativeCorrectionError("No se puede verificar la anulación: esta solicitud liquidada no tiene un préstamo vinculado.");
    return { event: "SOLICITUD_DISMISSED", loanId: null };
  }
  const control = s.administrativeCoreControl as Prisma.JsonObject | null;
  let loan: CoreLoanLifecycle | null;
  try {
    loan = await lifecycle(s.legacyOid, Boolean(control?.replacementId || control?.generatedLoanId));
  } catch {
    throw new AdministrativeCorrectionError("No se pudo verificar la anulación del préstamo en Vimarx. Volvé a intentar cuando esté disponible.");
  }
  if (!fullyCancelledLoan(loan))
    throw new AdministrativeCorrectionError("Antes de desestimar, Vimarx debe confirmar el préstamo anulado, sin vigencia y con saldo cero.");
  return { event: "SOLICITUD_DISMISSED", loanId: s.legacyOid, verifiedLoanId: loan!.id,
    estado: loan!.estado, estadoLabel: loan!.estadoLabel, estadoPrestamo: loan!.estadoPrestamo,
    estadoPrestamoLabel: loan!.estadoPrestamoLabel, vigente: loan!.vigente, saldo: loan!.saldo };
}

export async function dismissalToRestore(db: Prisma.TransactionClient, s: Source) {
  if (s.estadoActual.code !== "Desestimada" || !s.desestimacionHistorialId || s.archivedAt) return null;
  const event = await db.solicitudEstadoHistorial.findUnique({
    where: { id: s.desestimacionHistorialId },
    include: { estadoAnterior: { include: { owner: true } } },
  });
  if (!event || event.solicitudId !== s.id || event.actionCode !== "desestimar" ||
    event.estadoNuevoId !== s.estadoActualId || !event.estadoAnterior ||
    event.estadoAnterior.code === "Desestimada" || !event.estadoAnterior.isActive) return null;
  return event;
}

export async function dismissalReversalTransition(db: Prisma.TransactionClient, s: Source): Promise<WorkflowTransition | null> {
  const event = await dismissalToRestore(db, s);
  if (!event) return null;
  const target = event.estadoAnterior!;
  return {
    id: event.id, actionCode: REVERSE_DISMISSAL_ACTION,
    actionLabel: "Revertir desestimación: volver a " + target.name,
    blockedReason: null, defaultComment: null,
    description: "Restaura exclusivamente el estado anterior. No reactiva ni modifica el préstamo de Vimarx.",
    fromStateId: s.estadoActualId, requiresComment: true, saveAndExit: false, sortOrder: 10,
    toState: { id: target.id, code: target.code, name: target.name,
      owner: { id: target.owner.id, code: target.owner.code, name: target.owner.name } },
  };
}

export async function applyDismissalReversal(db: Prisma.TransactionClient, command: WorkflowCommand) {
  assertAdministrativeActor(command);
  const actor = await db.user.findFirst({ where: { id: command.changedBy, isSystemAdmin: true, state: 1, deletedAt: null } });
  if (!actor) throw new ForbiddenSolicitudAccessError();
  if (!command.comment?.trim()) throw new SolicitudWorkflowCommentRequiredError();
  await db.$queryRaw`SELECT id FROM solicitudes WHERE id = ${command.solicitudId}::uuid FOR UPDATE`;
  const s = await administrativeSource(db, command.solicitudId);
  assertNoLoanReplacementPending(s);
  const event = await dismissalToRestore(db, s);
  if (!event || command.dismissalReversal?.historyId !== event.id ||
    command.dismissalReversal.expectedUpdatedAt !== s.updatedAt.toISOString())
    throw new WorkflowExecutionPlanStateConflictError();
  const target = event.estadoAnterior!;
  // No normal transition side effects: don't run Motor, assign an executive,
  // reset analysis, recompute the risk cap, re-sign or reactivate a Core loan.
  await db.solicitud.update({ where: { id: s.id, estadoActualId: s.estadoActualId, updatedAt: s.updatedAt },
    data: { estadoActualId: target.id, desestimacionHistorialId: null } });
  await db.solicitudEstadoHistorial.create({ data: {
    ...actingHistoryFields(), solicitudId: s.id, transitionId: null,
    estadoAnteriorId: s.estadoActualId, estadoNuevoId: target.id,
    fromStateCodeSnapshot: s.estadoActual.code, fromStateNameSnapshot: s.estadoActual.name,
    fromOwnerIdSnapshot: s.estadoActual.owner.id, fromOwnerCodeSnapshot: s.estadoActual.owner.code,
    fromOwnerNameSnapshot: s.estadoActual.owner.name,
    toStateCodeSnapshot: target.code, toStateNameSnapshot: target.name,
    toOwnerIdSnapshot: target.owner.id, toOwnerCodeSnapshot: target.owner.code, toOwnerNameSnapshot: target.owner.name,
    actionCode: REVERSE_DISMISSAL_ACTION, actionLabel: "Desestimación revertida",
    changedBy: actor.id, realActorUserId: actingContext.getStore()?.administrator.id ?? actor.id,
    changedAt: command.now, comentario: command.comment.trim(), motivo: "DISMISSAL_REVERSED",
    requiresComment: true, saveAndExit: false,
    metadata: { event: "DISMISSAL_REVERSED", reversedHistoryId: event.id, loanId: s.legacyOid,
      assignedToUserId: s.assignedToUserId, vimarxUnchanged: true },
  } });
}
