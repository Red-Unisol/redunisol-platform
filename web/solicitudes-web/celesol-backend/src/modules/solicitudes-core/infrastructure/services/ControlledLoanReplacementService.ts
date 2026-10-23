import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import type { CreatePrestamoLegacyUseCase } from "../../application/use-cases/CreatePrestamoLegacy.use-case";
import type { CrearPrestamoGateway, CrearPrestamoInput } from "./CrearPrestamoGateway";
import {
  administrativeInclude, administrativeSource, assertAdministrativeActor,
  type CoreLoanSnapshot,
} from "./AdministrativeCorrectionService";
import {
  AdministrativeCorrectionError, assertNoLoanReplacementPending, coreConditionsFingerprint,
} from "../../domain/workflow/AdministrativeCorrection";

export type CoreLoanLifecycle = {
  id: string | null; account: string | null; estado: number | null;
  estadoLabel: string | null; estadoPrestamo: number | null;
  estadoPrestamoLabel: string | null; vigente: boolean | null; saldo: number | null;
};
type Source = Prisma.SolicitudGetPayload<{ include: typeof administrativeInclude }>;
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const editableStates = ["Revisar", "RevisionRiesgo", "PreAprobada", "Confirmada"];
const downstreamStates = ["Liquidada", "VerificarFirmaYDocumentacion", "Transferir", "Pagada"];

export function assertCancelledLoan(loan: CoreLoanLifecycle | null) {
  const cancelled = (v: string | null) => /^anulad[oa]$/i.test(v?.trim() ?? "");
  if (!loan?.id || !cancelled(loan.estadoLabel) || !cancelled(loan.estadoPrestamoLabel) ||
    loan.vigente !== false || loan.saldo !== 0)
    throw new AdministrativeCorrectionError("Vimarx debe confirmar que el préstamo anterior está anulado, sin vigencia y con saldo cero. No se anula desde Beex.");
}

export class ControlledLoanReplacementService {
  constructor(private readonly deps: {
    db: PrismaClient;
    creationTimeoutMs?: number;
    prepare: Pick<CreatePrestamoLegacyUseCase, "prepareReplacement">;
    gateway: Pick<CrearPrestamoGateway, "crear">;
    lifecycle: (id: string, directLoanId?: boolean) => Promise<CoreLoanLifecycle | null>;
    loanSnapshot: (id: string, documento: string, directLoanId?: boolean) => Promise<CoreLoanSnapshot | null>;
    makeSignatureLink: (id: string, codigoMutual: string | null) => string;
  }) {}

  private async actor(tx: Prisma.TransactionClient, user: AuthUser) {
    assertAdministrativeActor(user);
    const actor = await tx.user.findFirst({ where: { id: user.id, isSystemAdmin: true, state: 1, deletedAt: null } });
    if (!actor) throw new AdministrativeCorrectionError("Se requiere un administrador activo.", 403);
    return actor;
  }

  private async eligible(tx: Prisma.TransactionClient, s: Source, allowPending = false) {
    const control = s.administrativeCoreControl as Record<string, unknown> | null;
    if (!control?.correctionId || !s.legacyOid || s.archivedAt || !editableStates.includes(s.estadoActual.code))
      throw new AdministrativeCorrectionError("El reemplazo excepcional requiere una solicitud devuelta administrativamente, con préstamo vinculado y anterior a la liquidación.");
    if (!allowPending) assertNoLoanReplacementPending(s);
    if (s.desembolso || s.pagoExterno || await tx.solicitudEstadoHistorial.findFirst({
      where: { solicitudId: s.id, toStateCodeSnapshot: { in: downstreamStates } }, select: { id: true },
    })) throw new AdministrativeCorrectionError("No se puede reemplazar un préstamo con antecedentes de liquidación, reservas o pagos.");
  }

  private async audit(tx: Prisma.TransactionClient, s: Source, actorId: string, event: string, reason: string, metadata: unknown) {
    await tx.solicitudEstadoHistorial.create({ data: {
      solicitudId: s.id, estadoAnteriorId: s.estadoActualId, estadoNuevoId: s.estadoActualId,
      fromStateCodeSnapshot: s.estadoActual.code, toStateCodeSnapshot: s.estadoActual.code,
      fromStateNameSnapshot: s.estadoActual.name, toStateNameSnapshot: s.estadoActual.name,
      fromOwnerIdSnapshot: s.estadoActual.ownerId, toOwnerIdSnapshot: s.estadoActual.ownerId,
      fromOwnerCodeSnapshot: s.estadoActual.owner.code, toOwnerCodeSnapshot: s.estadoActual.owner.code,
      fromOwnerNameSnapshot: s.estadoActual.owner.name, toOwnerNameSnapshot: s.estadoActual.owner.name,
      actionCode: event, actionLabel: event === "ADMIN_LOAN_REPLACED" ? "Préstamo anulado reemplazado"
        : event === "ADMIN_LOAN_REPLACEMENT_STARTED" ? "Reemplazo excepcional iniciado"
          : event === "ADMIN_LOAN_REPLACEMENT_RECOVERED" ? "Préstamo generado recuperado"
            : "Resultado de reemplazo pendiente de verificar",
      changedBy: actorId, realActorUserId: actorId, comentario: reason,
      motivo: event, requiresComment: true, metadata: json(metadata),
    } });
  }

  async view(id: string, user: AuthUser) {
    const s = await administrativeSource(this.deps.db, id);
    let canAdmin = true;
    try { assertAdministrativeActor(user); } catch { canAdmin = false; }
    let blockedReason: string | null = null;
    try { await this.eligible(this.deps.db, s); } catch (e) {
      if (!(e instanceof AdministrativeCorrectionError)) throw e;
      blockedReason = e.message;
    }
    const operations = await this.deps.db.solicitudPrestamoReplacement.findMany({
      where: { solicitudId: id }, orderBy: { createdAt: "desc" }, take: 5,
      select: { id: true, previousLoanId: true, newLoanId: true, status: true, createdAt: true, completedAt: true },
    });
    const last = operations[0];
    const canRecover = Boolean(last && last.status !== "LINKED" && (last.status !== "CREATING" || Date.now() - last.createdAt.getTime() > (this.deps.creationTimeoutMs ?? 30000) + 60000));
    return { canRecover: canAdmin && canRecover, canAdmin, canReplace: canAdmin && !blockedReason, blockedReason,
      updatedAt: s.updatedAt.toISOString(), currentLoanId: s.legacyOid, operations,
      amount: s.montoAFinanciar === null ? null : Number(s.montoAFinanciar), cuotas: s.cuotas,
      line: s.lineaPrestamoDescripcion };
  }

  async replace(id: string, user: AuthUser, input: {
    requestId: string; expectedUpdatedAt: string; previousLoanId: string; reason: string;
  }) {
    assertAdministrativeActor(user);
    const existing = await this.deps.db.solicitudPrestamoReplacement.findUnique({ where: { id: input.requestId } });
    if (existing) {
      if (existing.solicitudId !== id || existing.previousLoanId !== input.previousLoanId)
        throw new AdministrativeCorrectionError("La operación no corresponde a esta solicitud.");
      if (existing.status === "LINKED") return this.view(id, user);
      if (existing.status === "CREATED" && existing.newLoanId)
        return this.finish(existing.id, user);
      throw new AdministrativeCorrectionError("El intento ya fue enviado a Vimarx. No lo repitas; verificá el resultado y usá Vincular préstamo generado.");
    }
    const before = await administrativeSource(this.deps.db, id);
    await this.eligible(this.deps.db, before);
    if (before.updatedAt.toISOString() !== input.expectedUpdatedAt || before.legacyOid !== input.previousLoanId)
      throw new AdministrativeCorrectionError("La solicitud cambió. Guardá y revisá las condiciones antes de reemplazar.");
    const previous = await this.deps.lifecycle(before.legacyOid!, Boolean((before.administrativeCoreControl as Prisma.JsonObject).replacementId));
    assertCancelledLoan(previous);
    const prepared = await this.deps.prepare.prepareReplacement({
      solicitudId: id, currentUser: { id: user.id, isSystemAdmin: true, workflowOwnerId: user.workflowOwnerId ?? "" },
    });
    const fingerprint = coreConditionsFingerprint(before);
    try {
      await this.deps.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
        await this.actor(tx, user);
        const s = await administrativeSource(tx, id);
        await this.eligible(tx, s);
        if (s.updatedAt.toISOString() !== input.expectedUpdatedAt || coreConditionsFingerprint(s) !== fingerprint)
          throw new AdministrativeCorrectionError("Las condiciones cambiaron durante la verificación. Actualizá el detalle.");
        await tx.solicitudPrestamoReplacement.create({ data: {
          id: input.requestId, solicitudId: id, previousLoanId: s.legacyOid!, status: "CREATING",
          reason: input.reason, actorId: user.id, previousSnapshot: json({
            lifecycle: previous, signatureLink: s.linkFirmaDigital, codigoMutual: s.lineaPrestamoCodigoMutual,
          }), intendedInput: json({ core: prepared.coreInput, codigoMutual: prepared.codigoMutual }),
          sourceFingerprint: fingerprint,
        } });
        await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: {
          ...(s.administrativeCoreControl as Prisma.JsonObject), replacementPending: input.requestId,
          reconciledFingerprint: null,
        } } });
        await this.audit(tx, s, user.id, "ADMIN_LOAN_REPLACEMENT_STARTED", input.reason, {
          operationId: input.requestId, previousLoanId: s.legacyOid, verifiedCancellation: previous,
          amount: prepared.coreInput.montoDeseado, cuotas: prepared.coreInput.cuotas,
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002")
        throw new AdministrativeCorrectionError("Ya existe un intento para este préstamo. Actualizá el detalle y verificá su resultado.");
      throw e;
    }
    let newLoanId: string;
    try {
      const result = await this.deps.gateway.crear(prepared.coreInput);
      newLoanId = result.id;
      if (!/^[1-9]\d*$/.test(newLoanId) || [input.previousLoanId, previous!.id].includes(newLoanId))
        throw new Error("Invalid replacement ID");
    } catch {
      // An HTTP error or timeout cannot prove that Vimarx did not create the
      // loan. The durable reservation must survive and block blind retries.
      await this.deps.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
        const s = await administrativeSource(tx, id);
        const marked = await tx.solicitudPrestamoReplacement.updateMany({ where: { id: input.requestId, status: "CREATING" }, data: { status: "UNCERTAIN" } });
        if (!marked.count) return;
        await this.audit(tx, s, user.id, "ADMIN_LOAN_REPLACEMENT_UNCERTAIN", input.reason, { operationId: input.requestId, previousLoanId: input.previousLoanId });
      });
      throw new AdministrativeCorrectionError("Vimarx no confirmó el resultado. No generes otro préstamo: verificá Vimarx y usá Vincular préstamo generado si ya existe.");
    }
    try {
      const stored = await this.deps.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
        const updated = await tx.solicitudPrestamoReplacement.updateMany({
          where: { id: input.requestId, status: "CREATING", newLoanId: null },
          data: { newLoanId, status: "CREATED" },
        });
        if (updated.count) return true;
        const current = await tx.solicitudPrestamoReplacement.findUniqueOrThrow({ where: { id: input.requestId } });
        if (current.newLoanId === newLoanId) return true;
        const s = await administrativeSource(tx, id);
        await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: {
          ...(s.administrativeCoreControl as Prisma.JsonObject), replacementPending: input.requestId, reconciledFingerprint: null,
        } } });
        await this.audit(tx, s, user.id, "ADMIN_LOAN_REPLACEMENT_UNCERTAIN", "Respuesta tardía de Vimarx distinta del préstamo recuperado", {
          operationId: input.requestId, recordedLoanId: current.newLoanId, lateLoanId: newLoanId,
        });
        return false;
      });
      if (!stored) throw new Error("Conflicting Core result");
    } catch {
      throw new AdministrativeCorrectionError(`Vimarx devolvió el préstamo ${newLoanId}, pero no pudo vincularse con certeza. No generes otro; revisá el historial y recuperá el ID correcto.`);
    }
    return this.finish(input.requestId, user);
  }

  private async finish(operationId: string, user: AuthUser) {
    const op = await this.deps.db.solicitudPrestamoReplacement.findUniqueOrThrow({ where: { id: operationId } });
    await this.deps.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${op.solicitudId}::uuid FOR UPDATE`;
      await this.actor(tx, user);
      const currentOp = await tx.solicitudPrestamoReplacement.findUniqueOrThrow({ where: { id: operationId } });
      if (currentOp.status === "LINKED") return;
      if (currentOp.status !== "CREATED" || !currentOp.newLoanId)
        throw new AdministrativeCorrectionError("El préstamo nuevo todavía no tiene un ID confirmado.");
      const s = await administrativeSource(tx, op.solicitudId);
      await this.eligible(tx, s, true);
      if (s.legacyOid !== op.previousLoanId ||
        (s.administrativeCoreControl as Prisma.JsonObject).replacementPending !== operationId ||
        coreConditionsFingerprint(s) !== op.sourceFingerprint)
        throw new AdministrativeCorrectionError("La solicitud cambió durante la generación. El nuevo préstamo quedó registrado para recuperación; no repitas la operación.");
      if (await tx.solicitud.findFirst({ where: { id: { not: s.id }, legacyOid: currentOp.newLoanId }, select: { id: true } }))
        throw new AdministrativeCorrectionError("El préstamo nuevo ya está vinculado a otra solicitud. El intento se conserva para investigación; no generes otro.");
      const intended = currentOp.intendedInput as { codigoMutual: string | null };
      await tx.solicitud.update({ where: { id: s.id }, data: {
        legacyOid: currentOp.newLoanId,
        lineaPrestamoCodigoMutual: intended.codigoMutual,
        linkFirmaDigital: this.deps.makeSignatureLink(currentOp.newLoanId, intended.codigoMutual),
        administrativeCoreControl: {
          ...(s.administrativeCoreControl as Prisma.JsonObject),
          loanId: currentOp.newLoanId, previousLoanId: op.previousLoanId, replacementId: operationId,
          replacementPending: null, reconciledFingerprint: null,
        },
      } });
      await this.audit(tx, s, user.id, "ADMIN_LOAN_REPLACED", `${op.reason}\nPréstamo anterior: ${op.previousLoanId}. Nuevo: ${currentOp.newLoanId}.`, {
        operationId, previousLoanId: op.previousLoanId, newLoanId: currentOp.newLoanId,
        previousSnapshot: currentOp.previousSnapshot,
        coreReconciliationRequired: true,
      });
      await tx.solicitudPrestamoReplacement.update({
        where: { id: operationId }, data: { status: "LINKED", completedAt: new Date() },
      });
    });
    return this.view(op.solicitudId, user);
  }

  async recover(id: string, user: AuthUser, input: {
    requestId: string; expectedUpdatedAt: string; newLoanId: string; reason: string;
  }) {
    assertAdministrativeActor(user);
    const op = await this.deps.db.solicitudPrestamoReplacement.findUnique({ where: { id: input.requestId } });
    if (!op || op.solicitudId !== id) throw new AdministrativeCorrectionError("No existe ese intento para esta solicitud.");
    if (op.status === "LINKED") {
      if (op.newLoanId !== input.newLoanId) throw new AdministrativeCorrectionError("El intento ya está vinculado a otro préstamo.");
      return this.view(id, user);
    }
    if (op.status === "CREATING" && Date.now() - op.createdAt.getTime() <= (this.deps.creationTimeoutMs ?? 30000) + 60000)
      throw new AdministrativeCorrectionError("La llamada a Vimarx todavía puede estar en curso. Esperá antes de recuperar el resultado.");
    if (input.newLoanId === op.previousLoanId || (op.newLoanId && op.newLoanId !== input.newLoanId))
      throw new AdministrativeCorrectionError("El ID no corresponde al préstamo de reemplazo.");
    const before = await administrativeSource(this.deps.db, id);
    if (!before.titular?.nroDocumento) throw new AdministrativeCorrectionError("Falta identificar al titular.");
    const priorSnapshot = op.previousSnapshot as { lifecycle?: { id?: string } };
    const [previous, loan] = await Promise.all([
      this.deps.lifecycle(priorSnapshot.lifecycle?.id ?? op.previousLoanId, Boolean(priorSnapshot.lifecycle?.id)),
      this.deps.loanSnapshot(input.newLoanId, before.titular.nroDocumento, true),
    ]);
    assertCancelledLoan(previous);
    const intended = op.intendedInput as unknown as { core: CrearPrestamoInput };
    if (!loan || loan.estado !== 0 || loan.id !== input.newLoanId ||
      loan.amount !== intended.core.montoDeseado || loan.cuotas !== intended.core.cuotas ||
      loan.lineaId !== intended.core.lineaPrestamo ||
      loan.cancelacionesCentavos !== (intended.core.nroLote ?? 0))
      throw new AdministrativeCorrectionError("El préstamo indicado no está activo o no coincide con el titular y las condiciones del intento.");
    await this.deps.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      await this.actor(tx, user);
      const s = await administrativeSource(tx, id);
      await this.eligible(tx, s, true);
      if (s.updatedAt.toISOString() !== input.expectedUpdatedAt || coreConditionsFingerprint(s) !== op.sourceFingerprint)
        throw new AdministrativeCorrectionError("La solicitud cambió. Actualizá y revisá el intento pendiente.");
      const current = await tx.solicitudPrestamoReplacement.findUniqueOrThrow({ where: { id: op.id } });
      if (current.status === "LINKED" || (current.newLoanId && current.newLoanId !== input.newLoanId))
        throw new AdministrativeCorrectionError("El intento cambió durante la verificación.");
      await tx.solicitudPrestamoReplacement.update({ where: { id: op.id }, data: { status: "CREATED", newLoanId: input.newLoanId } });
      await this.audit(tx, s, user.id, "ADMIN_LOAN_REPLACEMENT_RECOVERED", input.reason, {
        operationId: op.id, previousLoanId: op.previousLoanId, newLoanId: input.newLoanId, verifiedLoan: loan,
      });
    });
    return this.finish(op.id, user);
  }
}
