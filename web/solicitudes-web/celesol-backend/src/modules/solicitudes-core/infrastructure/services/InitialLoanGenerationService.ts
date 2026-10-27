import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { CreatePrestamoLegacyInput } from "../../application/dtos/CreatePrestamoLegacy.dto";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import { AdministrativeCorrectionError, assertNoLoanReplacementPending, coreConditionsFingerprint } from "../../domain/workflow/AdministrativeCorrection";
import { administrativeSource, assertAdministrativeActor, type CoreLoanSnapshot } from "./AdministrativeCorrectionService";
import type { CrearPrestamoGateway, CrearPrestamoInput } from "./CrearPrestamoGateway";
import { notifySignatureLinkAvailable } from "../../../notifications/SignatureNotifications";
import { actingContext } from "../../../auth/impersonation/context";
import { assertLinkedLoanReady, type LinkedLoanReader } from "../../application/services/LinkedLoanRules";

export type PreparedInitialLoan = { solicitud: SolicitudCore; codigoMutual: string | null; coreInput: CrearPrestamoInput };
type Reservation = {
  requestId: string; actorId: string; createdAt: string; status: "CREATING" | "UNCERTAIN" | "CREATED";
  sourceFingerprint: string; coreInput: CrearPrestamoInput; codigoMutual: string | null; newLoanId?: string;
};
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const control = (value: unknown) => (value ?? {}) as Prisma.JsonObject;
const reservation = (value: unknown) => (control(value).generationPending ?? null) as Reservation | null;

/** Durable reservation precedes the remote call; uncertain calls never retry blindly. */
export class InitialLoanGenerationService {
  constructor(private readonly deps: {
    db: PrismaClient;
    repository: Pick<SolicitudesCoreRepository, "findById">;
    gateway: Pick<CrearPrestamoGateway, "crear">;
    linkedLoanReader: LinkedLoanReader;
    loanSnapshot: (id: string, documento: string, direct?: boolean) => Promise<CoreLoanSnapshot | null>;
    makeSignatureLink: (id: string, codigoMutual: string | null) => string;
    creationTimeoutMs?: number;
  }) {}

  private async result(id: string) {
    const result = await this.deps.repository.findById(id);
    if (!result) throw new AdministrativeCorrectionError("No se encontró la solicitud generada.");
    return result;
  }

  private async audit(tx: Prisma.TransactionClient, s: Awaited<ReturnType<typeof administrativeSource>>, actorId: string, action: string, metadata: unknown, reason: string | null = null) {
    await tx.solicitudEstadoHistorial.create({ data: {
      solicitudId: s.id, estadoAnteriorId: s.estadoActualId, estadoNuevoId: s.estadoActualId,
      fromStateCodeSnapshot: s.estadoActual.code, toStateCodeSnapshot: s.estadoActual.code,
      fromStateNameSnapshot: s.estadoActual.name, toStateNameSnapshot: s.estadoActual.name,
      fromOwnerIdSnapshot: s.estadoActual.ownerId, toOwnerIdSnapshot: s.estadoActual.ownerId,
      fromOwnerCodeSnapshot: s.estadoActual.owner.code, toOwnerCodeSnapshot: s.estadoActual.owner.code,
      fromOwnerNameSnapshot: s.estadoActual.owner.name, toOwnerNameSnapshot: s.estadoActual.owner.name,
      actionCode: action, actionLabel: action === "LOAN_GENERATED" ? "Préstamo generado" : action === "LOAN_GENERATION_STARTED" ? "Generación de préstamo iniciada" : "Generación pendiente de verificar",
      changedBy: actorId, realActorUserId: actingContext.getStore()?.administrator.id ?? actorId,
      metadata: json(metadata), comentario: reason,
    } });
  }

  async create(prepared: PreparedInitialLoan, input: CreatePrestamoLegacyInput) {
    const id = input.solicitudId;
    const pending = await this.deps.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      const s = await administrativeSource(tx, id);
      const actor = await tx.user.findFirst({ where: { id: input.currentUser.id, state: 1, deletedAt: null } });
      if (!actor || (!actor.isSystemAdmin && actor.workflowOwnerId !== s.estadoActual.ownerId))
        throw new AdministrativeCorrectionError("No tenés permiso para generar este préstamo.", 403);
      if (s.legacyOid) return null;
      assertNoLoanReplacementPending(s);
      if (s.archivedAt || s.estadoActual.code !== "Confirmada" || s.desembolso || s.pagoExterno)
        throw new AdministrativeCorrectionError("El préstamo sólo puede generarse desde Confirmada, antes de reservar o pagar.");
      const cancellations = s.cancelaciones.filter(c => !c.deletedAt).reduce((sum, c) => sum + Number(c.monto), 0);
      if (s.updatedAt.getTime() !== prepared.solicitud.updatedAt.getTime() ||
        Number(s.montoAFinanciar) !== prepared.coreInput.montoDeseado || s.cuotas !== prepared.coreInput.cuotas ||
        s.lineaPrestamoLegacyOid !== prepared.solicitud.lineaPrestamoLegacyOid ||
        s.titular?.nroDocumento !== prepared.solicitud.titular.nroDocumento ||
        Math.round(cancellations * 100) !== (prepared.coreInput.nroLote ?? 0))
        throw new AdministrativeCorrectionError("Las condiciones cambiaron antes de generar. Actualizá la solicitud y volvé a revisar.");
      const next: Reservation = {
        requestId: randomUUID(), actorId: actor.id, createdAt: new Date().toISOString(), status: "CREATING",
        sourceFingerprint: coreConditionsFingerprint(s), coreInput: prepared.coreInput, codigoMutual: prepared.codigoMutual,
      };
      await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: { ...control(s.administrativeCoreControl), generationPending: json(next) } } });
      await this.audit(tx, s, actor.id, "LOAN_GENERATION_STARTED", { requestId: next.requestId, amount: prepared.coreInput.montoDeseado });
      return next;
    });
    if (!pending) {
      const s = await administrativeSource(this.deps.db, id);
      assertLinkedLoanReady(await this.deps.linkedLoanReader(s));
      return this.result(id);
    }
    let newLoanId: string;
    try {
      newLoanId = (await this.deps.gateway.crear(prepared.coreInput)).id;
      if (!/^[1-9]\d*$/.test(newLoanId)) throw new Error("Invalid loan ID");
    } catch {
      await this.deps.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
        const s = await administrativeSource(tx, id);
        const current = reservation(s.administrativeCoreControl);
        if (current?.requestId !== pending.requestId || current.status !== "CREATING") return;
        await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: {
          ...control(s.administrativeCoreControl), generationPending: json({ ...current, status: "UNCERTAIN" }),
        } } });
        await this.audit(tx, s, pending.actorId, "LOAN_GENERATION_UNCERTAIN", { requestId: pending.requestId });
      });
      throw new AdministrativeCorrectionError("Vimarx no confirmó la generación. No generes otro préstamo: un administrador debe verificar y recuperar el resultado.");
    }
    await this.deps.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      const s = await administrativeSource(tx, id);
      const current = reservation(s.administrativeCoreControl);
      if (current?.requestId !== pending.requestId || !["CREATING", "UNCERTAIN"].includes(current.status))
        throw new AdministrativeCorrectionError(`Vimarx generó el préstamo ${newLoanId}, pero la reserva cambió. No repitas la generación; solicitá recuperación.`);
      await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: {
        ...control(s.administrativeCoreControl), generationPending: json({ ...current, status: "CREATED", newLoanId }),
      } } });
    });
    return this.link(id, pending.requestId, newLoanId, pending.actorId);
  }

  private async link(id: string, requestId: string, newLoanId: string, actorId: string, reason: string | null = null) {
    await this.deps.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      const s = await administrativeSource(tx, id);
      const pending = reservation(s.administrativeCoreControl);
      if (s.legacyOid === newLoanId && control(s.administrativeCoreControl).generationRequestId === requestId) return;
      if (s.legacyOid || pending?.requestId !== requestId ||
        coreConditionsFingerprint(s) !== pending.sourceFingerprint || s.archivedAt ||
        s.estadoActual.code !== "Confirmada" || s.desembolso || s.pagoExterno)
        throw new AdministrativeCorrectionError("La solicitud cambió. El préstamo generado quedó reservado para recuperación; no generes otro.");
      const actor = await tx.user.findFirst({ where: { id: actorId, state: 1, deletedAt: null } });
      if (!actor || (reason ? !actor.isSystemAdmin : (!actor.isSystemAdmin && actor.workflowOwnerId !== s.estadoActual.ownerId)))
        throw new AdministrativeCorrectionError("El responsable ya no tiene permiso para vincular el préstamo; solicitá recuperación administrativa.", 403);
      if (await tx.solicitud.findFirst({ where: { id: { not: id }, legacyOid: newLoanId }, select: { id: true } }))
        throw new AdministrativeCorrectionError("El préstamo ya está vinculado a otra solicitud. Solicitá una revisión administrativa.");
      await tx.solicitud.update({ where: { id }, data: {
        legacyOid: newLoanId, lineaPrestamoCodigoMutual: pending.codigoMutual,
        linkFirmaDigital: this.deps.makeSignatureLink(newLoanId, pending.codigoMutual),
        analisisFinalizadoAt: null, analisisFinalizadoBy: null,
        signatureCycleId: null, signatureRequestedAt: null, signatureRequestReason: null,
        signatureExcludedVerificationIds: Prisma.DbNull,
        administrativeCoreControl: { ...control(s.administrativeCoreControl), generationPending: null,
          generatedLoanId: newLoanId, generationRequestId: requestId, loanId: newLoanId,
          reconciledFingerprint: coreConditionsFingerprint({ ...s, legacyOid: newLoanId }),
        },
      } });
      await this.audit(tx, s, actorId, "LOAN_GENERATED", { requestId, newLoanId, recovered: Boolean(reason) }, reason);
      await notifySignatureLinkAvailable(tx, id);
    });
    return this.result(id);
  }

  async recover(id: string, user: CreatePrestamoLegacyInput["currentUser"], input: {
    requestId: string; expectedUpdatedAt: string; newLoanId: string; reason: string;
  }) {
    assertAdministrativeActor(user);
    const s = await administrativeSource(this.deps.db, id);
    if (s.legacyOid === input.newLoanId && control(s.administrativeCoreControl).generationRequestId === input.requestId) return this.result(id);
    const pending = reservation(s.administrativeCoreControl);
    if (!pending || pending.requestId !== input.requestId || s.updatedAt.toISOString() !== input.expectedUpdatedAt || !s.titular?.nroDocumento)
      throw new AdministrativeCorrectionError("La reserva de generación cambió. Actualizá el detalle antes de recuperar.");
    if (pending.status === "CREATING" && Date.now() - new Date(pending.createdAt).getTime() <= (this.deps.creationTimeoutMs ?? 30000) + 60000)
      throw new AdministrativeCorrectionError("La llamada de generación todavía puede estar en curso. Esperá antes de recuperar.");
    if (pending.newLoanId && pending.newLoanId !== input.newLoanId)
      throw new AdministrativeCorrectionError("El ID no coincide con la respuesta registrada de Vimarx.");
    const loan = await this.deps.loanSnapshot(input.newLoanId, s.titular.nroDocumento, true);
    if (!loan || loan.id !== input.newLoanId || loan.estado !== 0 || loan.amount !== pending.coreInput.montoDeseado ||
      loan.cuotas !== pending.coreInput.cuotas || loan.lineaId !== pending.coreInput.lineaPrestamo ||
      loan.cancelacionesCentavos !== (pending.coreInput.nroLote ?? 0))
      throw new AdministrativeCorrectionError("El préstamo no está activo o no coincide con el titular y las condiciones reservadas.");
    return this.link(id, input.requestId, input.newLoanId, user.id, input.reason);
  }
}
