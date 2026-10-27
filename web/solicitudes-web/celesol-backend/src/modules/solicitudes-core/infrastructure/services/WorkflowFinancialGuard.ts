import type { PrismaClient, Prisma } from "@prisma/client";
import { inspectLinkedLoan, assertLinkedLoanReady, type LinkedLoanGateways } from "../../application/services/LinkedLoanRules";
import { administrativeSource, type CoreLoanSnapshot } from "./AdministrativeCorrectionService";
import type { LineaPrestamoLegacyIdResolver } from "../../domain/services/LineaPrestamoLegacyIdResolver";
import { AdministrativeCorrectionError, assertNoLoanReplacementPending, coreConditionsFingerprint, coreReconciliationPending } from "../../domain/workflow/AdministrativeCorrection";
import { actingContext } from "../../../auth/impersonation/context";

type GuardDependencies = LinkedLoanGateways & { lineResolver: LineaPrestamoLegacyIdResolver };
async function productionDependencies(): Promise<GuardDependencies> {
  const { env } = await import("../../../../config/env.js");
  const { EvaluateListSolicitudesGateway } = await import("../../../solicitudes/infrastructure/services/EvaluateListSolicitudesGateway.js");
  const { EvaluateListLineaPrestamoLegacyIdResolver } = await import("./EvaluateListLineaPrestamoLegacyIdResolver.js");
  const gateway = new EvaluateListSolicitudesGateway({ baseUrl: env.LEGACY_API_BASE_URL, timeoutMs: env.LEGACY_API_TIMEOUT_MS });
  return {
    lifecycle: (loanId, direct) => gateway.getCoreLoanLifecycle(loanId, direct),
    loanSnapshot: (loanId, documento, direct) => gateway.getCoreReconciliationSnapshot(loanId, documento, direct),
    lineResolver: new EvaluateListLineaPrestamoLegacyIdResolver({ baseUrl: env.LEGACY_API_BASE_URL, timeoutMs: env.LEGACY_API_TIMEOUT_MS }),
  };
}

/** Read-only proof for serving a signature or preflighting an approval. It
 * allows signing alongside analysis, without marking a reconciliation done. */
export async function assertSignatureLinkFinancialReady(
  db: PrismaClient | Prisma.TransactionClient,
  id: string,
  dependencies?: GuardDependencies,
): Promise<{ loanId: string; conditionsFingerprint: string }> {
  const deps = dependencies ?? await productionDependencies();
  const source = await administrativeSource(db, id);
  assertNoLoanReplacementPending(source);
  if (source.archivedAt || !["Revisar", "RevisionRiesgo", "PreAprobada", "Confirmada", "Liquidada", "VerificarFirmaYDocumentacion", "Transferir"].includes(source.estadoActual.code))
    throw new AdministrativeCorrectionError("La solicitud no admite firma en su estado actual.");
  const snapshots: CoreLoanSnapshot[] = [];
  const status = await inspectLinkedLoan(source, {
    lifecycle: deps.lifecycle,
    loanSnapshot: async (...args) => { const snapshot = await deps.loanSnapshot(...args); if (snapshot) snapshots.push(snapshot); return snapshot; },
  });
  assertLinkedLoanReady(status);
  const proof = snapshots[0];
  const line = await deps.lineResolver.resolveByPresolicitudOid(source.lineaPrestamoLegacyOid);
  const cancellations = source.cancelaciones.filter(c => !c.deletedAt).reduce((sum, c) => sum + Number(c.monto), 0);
  if (!proof || !line || source.montoAFinanciar === null || proof.estado !== 0 ||
    proof.id !== status.resolvedLoanId || proof.amount !== Number(source.montoAFinanciar) || proof.cuotas !== source.cuotas ||
    proof.lineaId !== line.id || proof.cancelacionesCentavos !== Math.round(cancellations * 100) ||
    (source.fechaPrimerVencimiento && proof.primerVencimiento?.slice(0, 10) !== source.fechaPrimerVencimiento.toISOString().slice(0, 10)))
    throw new AdministrativeCorrectionError("El préstamo no coincide con el titular y las condiciones de la firma. Revisá monto, cuotas, línea, vencimiento y cancelaciones en Vimarx.");
  const current = await administrativeSource(db, id);
  assertNoLoanReplacementPending(current);
  if (current.updatedAt.getTime() !== source.updatedAt.getTime() || current.archivedAt ||
    current.estadoActual.code !== source.estadoActual.code || coreConditionsFingerprint(current) !== coreConditionsFingerprint(source))
    throw new AdministrativeCorrectionError("La solicitud cambió durante la verificación de firma. Actualizá el enlace.");
  return { loanId: source.legacyOid!, conditionsFingerprint: coreConditionsFingerprint(source) };
}

/** Reconciles only against complete authoritative evidence; the existing
 * datasource reconciliation guard remains the final transactional gate. */
export async function assertWorkflowFinancialReady(
  db: PrismaClient | Prisma.TransactionClient,
  id: string,
  actorId?: string,
  dependencies?: GuardDependencies,
) {
  const deps = dependencies ?? await productionDependencies();
  const source = await administrativeSource(db, id);
  const snapshots: CoreLoanSnapshot[] = [];
  const status = await inspectLinkedLoan(source, {
    lifecycle: deps.lifecycle,
    loanSnapshot: async (...args) => { const result = await deps.loanSnapshot(...args); if (result) snapshots.push(result); return result; },
  });
  assertLinkedLoanReady(status);
  if (!coreReconciliationPending(source)) return;
  if (!actorId) throw new AdministrativeCorrectionError("La conciliación requiere un responsable autenticado.", 403);
  const proof = snapshots[0];
  const line = await deps.lineResolver.resolveByPresolicitudOid(source.lineaPrestamoLegacyOid);
  const cancellations = source.cancelaciones.filter(c => !c.deletedAt).reduce((sum, c) => sum + Number(c.monto), 0);
  if (!proof || !line || source.montoAFinanciar === null || proof.estado !== 0 ||
    proof.id !== status.resolvedLoanId || proof.amount !== Number(source.montoAFinanciar) || proof.cuotas !== source.cuotas ||
    proof.lineaId !== line.id || proof.cancelacionesCentavos !== Math.round(cancellations * 100) ||
    (source.fechaPrimerVencimiento && proof.primerVencimiento?.slice(0, 10) !== source.fechaPrimerVencimiento.toISOString().slice(0, 10)))
    throw new AdministrativeCorrectionError("El préstamo no pudo conciliarse con Beex. Revisá titular, monto, cuotas, línea, vencimiento y cancelaciones en Vimarx antes de continuar.");

  const apply = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await administrativeSource(tx, id);
    assertNoLoanReplacementPending(current);
    if (current.updatedAt.getTime() !== source.updatedAt.getTime() || coreConditionsFingerprint(current) !== coreConditionsFingerprint(source))
      throw new AdministrativeCorrectionError("La solicitud cambió durante la conciliación. Actualizá antes de continuar.");
    if (current.archivedAt || current.desembolso || current.pagoExterno ||
      !["Revisar", "RevisionRiesgo", "PreAprobada", "Confirmada", "Liquidada", "VerificarFirmaYDocumentacion", "Transferir"].includes(current.estadoActual.code))
      throw new AdministrativeCorrectionError("La solicitud no admite conciliación automática con reservas, pagos o en su estado actual.");
    const actor = await tx.user.findFirst({ where: { id: actorId, state: 1, deletedAt: null }, include: { workflowOwner: true } });
    const legacyLegajos = current.estadoActual.code === "Liquidada" && actor?.workflowOwner?.code === "LEGAJOS_DIGITALES";
    if (!actor || (!actor.isSystemAdmin && actor.workflowOwnerId !== current.estadoActual.ownerId && !legacyLegajos))
      throw new AdministrativeCorrectionError("El responsable no tiene permiso para conciliar esta operación.", 403);
    const reconciledAt = new Date();
    await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: {
      ...(current.administrativeCoreControl as Prisma.JsonObject),
      reconciledFingerprint: coreConditionsFingerprint(current), reconciledAt: reconciledAt.toISOString(), reconciledBy: actor.id,
    } } });
    await tx.solicitudEstadoHistorial.create({ data: {
      solicitudId: id, estadoAnteriorId: current.estadoActualId, estadoNuevoId: current.estadoActualId,
      fromStateCodeSnapshot: current.estadoActual.code, toStateCodeSnapshot: current.estadoActual.code,
      fromStateNameSnapshot: current.estadoActual.name, toStateNameSnapshot: current.estadoActual.name,
      fromOwnerIdSnapshot: current.estadoActual.ownerId, toOwnerIdSnapshot: current.estadoActual.ownerId,
      fromOwnerCodeSnapshot: current.estadoActual.owner.code, toOwnerCodeSnapshot: current.estadoActual.owner.code,
      fromOwnerNameSnapshot: current.estadoActual.owner.name, toOwnerNameSnapshot: current.estadoActual.owner.name,
      actionCode: "CORE_RECONCILED_AUTOMATICALLY", actionLabel: "Préstamo conciliado con Vimarx",
      changedBy: actor.id, realActorUserId: actingContext.getStore()?.administrator.id ?? actor.id,
      changedAt: reconciledAt, metadata: { loanId: current.legacyOid, verifiedLoan: proof, automaticallyVerified: true },
    } });
  };
  if ("$transaction" in db && typeof db.$transaction === "function") {
    await (db as PrismaClient).$transaction(apply);
  } else {
    await apply(db as Prisma.TransactionClient);
  }
}
