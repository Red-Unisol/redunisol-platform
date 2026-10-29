import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { LoanDiagnosticContext } from "../../../technical-diagnostics/LoanDiagnostics";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";
import type { SolicitudRefinanciacionCobro } from "../../domain/repositories/SolicitudRefinanciacionRepository";
import { AdministrativeCorrectionError } from "../../domain/workflow/AdministrativeCorrection";
import { actingContext } from "../../../auth/impersonation/context";
import { administrativeSource, assertAdministrativeActor } from "./AdministrativeCorrectionService";

type Source = Awaited<ReturnType<typeof administrativeSource>>;
type Charge = Omit<SolicitudRefinanciacionCobro, "cobradoAt">;
export type PendingRefinanciacionCobro = {
  operationId: string; prestamoId: string; nrosCuota: number[];
  startedAt: string; status: "PENDING" | "UNCERTAIN";
  response?: Charge;
};
type Generation = {
  requestId: string; actorId: string; status: string;
  refinanciacionCobro?: PendingRefinanciacionCobro;
};
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const control = (s: Source) => (s.administrativeCoreControl ?? {}) as Prisma.JsonObject;
const generation = (s: Source) => control(s).generationPending as Generation | undefined;
const validCharge = (charge: Charge) => /^[1-9]\d*$/.test(charge.cobroId) &&
  Number.isFinite(charge.totalCobrado) && charge.totalCobrado > 0 &&
  Math.round(charge.totalCobrado * 100) / 100 === charge.totalCobrado;

export type RefinanciacionCobroRecovery = {
  operationId: string; expectedUpdatedAt: string; reason: string;
} & ({ resolution: "CONFIRMED"; cobroId: string; totalCobrado: number } | { resolution: "NOT_APPLIED" });

/** The durable intent stays inside the loan reservation until its result is known. */
export class RefinanciacionCobrosService {
  constructor(private readonly deps: {
    db: PrismaClient;
    legacyGateway: Pick<SolicitudesLegacyGateway, "listCuotasDelPrestamo">;
    timeoutMs: number;
  }) {}

  private async locked<T>(id: string, fn: (tx: Prisma.TransactionClient, s: Source) => Promise<T>) {
    return this.deps.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM solicitudes WHERE id = ${id}::uuid FOR UPDATE`;
      return fn(tx, await administrativeSource(tx, id));
    });
  }

  private pending(s: Source, operationId: string) {
    const g = generation(s);
    if (!g?.refinanciacionCobro || g.refinanciacionCobro.operationId !== operationId || s.legacyOid)
      throw new AdministrativeCorrectionError("La reserva del cobro cambió. Actualizá la solicitud antes de conciliar.");
    return { g, operation: g.refinanciacionCobro };
  }

  private async audit(tx: Prisma.TransactionClient, s: Source, actorId: string, action: string, metadata: unknown, reason: string | null = null) {
    await tx.solicitudEstadoHistorial.create({ data: {
      solicitudId: s.id, estadoAnteriorId: s.estadoActualId, estadoNuevoId: s.estadoActualId,
      fromStateCodeSnapshot: s.estadoActual.code, toStateCodeSnapshot: s.estadoActual.code,
      fromStateNameSnapshot: s.estadoActual.name, toStateNameSnapshot: s.estadoActual.name,
      fromOwnerIdSnapshot: s.estadoActual.ownerId, toOwnerIdSnapshot: s.estadoActual.ownerId,
      fromOwnerCodeSnapshot: s.estadoActual.owner.code, toOwnerCodeSnapshot: s.estadoActual.owner.code,
      fromOwnerNameSnapshot: s.estadoActual.owner.name, toOwnerNameSnapshot: s.estadoActual.owner.name,
      actionCode: action, actionLabel: "Cobro de refinanciación",
      changedBy: actorId, realActorUserId: actingContext.getStore()?.administrator.id ?? actorId,
      comentario: reason, metadata: json(metadata),
    } });
  }

  async iniciar(input: { solicitudId: string; prestamoId: string; nrosCuota: number[]; context?: LoanDiagnosticContext }) {
    return this.locked(input.solicitudId, async (tx, s) => {
      const g = generation(s);
      if (!g || g.requestId !== input.context?.operationId || g.status !== "CREATING" || g.refinanciacionCobro || s.legacyOid)
        throw new AdministrativeCorrectionError("El cobro requiere una reserva de generación vigente y sin resultados inciertos.");
      const row = await tx.solicitudRefinanciacion.findUniqueOrThrow({ where: {
        solicitudId_prestamoLegacyId: { solicitudId: s.id, prestamoLegacyId: input.prestamoId },
      } });
      const cobros = row.cobros as unknown as Charge[];
      if (!input.nrosCuota.length || input.nrosCuota.some(n => !row.nrosCuota.includes(n) || cobros.some(c => c.nrosCuota.includes(n))))
        throw new AdministrativeCorrectionError("La selección o los cobros de refinanciación cambiaron. Volvé a revisar.");
      const operation: PendingRefinanciacionCobro = {
        operationId: randomUUID(), prestamoId: input.prestamoId, nrosCuota: input.nrosCuota,
        startedAt: new Date().toISOString(), status: "PENDING",
      };
      await tx.solicitud.update({ where: { id: s.id }, data: {
        administrativeCoreControl: { ...control(s), generationPending: json({ ...g, refinanciacionCobro: operation }) },
      } });
      await this.audit(tx, s, g.actorId, "REFINANCIACION_COBRO_STARTED", { requestId: g.requestId, ...operation });
      return operation.operationId;
    });
  }

  private async appendCharge(tx: Prisma.TransactionClient, s: Source, operation: PendingRefinanciacionCobro, charge: Charge) {
    if (!validCharge(charge))
      throw new AdministrativeCorrectionError("Vimarx no confirmó un identificador e importe válidos para el cobro.");
    const where = { solicitudId_prestamoLegacyId: { solicitudId: s.id, prestamoLegacyId: operation.prestamoId } };
    const row = await tx.solicitudRefinanciacion.findUniqueOrThrow({ where });
    const cobros = row.cobros as unknown as Charge[];
    if (cobros.some(c => c.cobroId === charge.cobroId || c.nrosCuota.some(n => operation.nrosCuota.includes(n))))
      throw new AdministrativeCorrectionError("El cobro o sus cuotas ya están registrados. Revisá la conciliación.");
    await tx.solicitudRefinanciacion.update({ where, data: {
      cobros: json([...cobros, { ...charge, nrosCuota: operation.nrosCuota, cobradoAt: new Date().toISOString() }]),
    } });
  }

  async confirmar(id: string, operationId: string, charge: Charge) {
    await this.locked(id, async (tx, s) => {
      const { g, operation } = this.pending(s, operationId);
      await this.appendCharge(tx, s, operation, charge);
      const next = { ...g }; delete next.refinanciacionCobro;
      await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: { ...control(s), generationPending: json(next) } } });
      await this.audit(tx, s, g.actorId, "REFINANCIACION_COBRO_CONFIRMED", { operationId, ...charge });
    });
  }

  async rechazar(id: string, operationId: string, message: string) {
    await this.locked(id, async (tx, s) => {
      const { g } = this.pending(s, operationId);
      const next = { ...g }; delete next.refinanciacionCobro;
      await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: { ...control(s), generationPending: json(next) } } });
      await this.audit(tx, s, g.actorId, "REFINANCIACION_COBRO_REJECTED", { operationId, message });
    });
  }

  async marcarIncierto(id: string, operationId: string, response?: Charge) {
    const known = response && validCharge(response) ? response : undefined;
    await this.locked(id, async (tx, s) => {
      const { g, operation } = this.pending(s, operationId);
      await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: {
        ...control(s), generationPending: json({ ...g, status: "UNCERTAIN", refinanciacionCobro: { ...operation, status: "UNCERTAIN", ...(known ? { response: known } : {}) } }),
      } } });
      await this.audit(tx, s, g.actorId, "REFINANCIACION_COBRO_UNCERTAIN", { operationId, response });
    });
  }

  async inspect(id: string, user: { isSystemAdmin?: boolean }) {
    assertAdministrativeActor(user);
    const s = await administrativeSource(this.deps.db, id);
    return { expectedUpdatedAt: s.updatedAt.toISOString(), pending: generation(s)?.refinanciacionCobro ?? null };
  }

  async recover(id: string, user: { id: string; isSystemAdmin?: boolean }, input: RefinanciacionCobroRecovery) {
    assertAdministrativeActor(user);
    const before = await administrativeSource(this.deps.db, id);
    const { operation } = this.pending(before, input.operationId);
    // A caller may still be processing an answer after the network timeout.
    if (Date.now() - new Date(operation.startedAt).getTime() <= this.deps.timeoutMs + 60000)
      throw new AdministrativeCorrectionError("El cobro todavía puede estar en curso. Esperá antes de conciliar.");
    const cuotas = await this.deps.legacyGateway.listCuotasDelPrestamo(operation.prestamoId);
    const matching = operation.nrosCuota.map(n => cuotas.find(c => c.nroCuota === n));
    const applied = input.resolution === "CONFIRMED";
    if (matching.some(c => !c || (applied
      ? !(c.fechaCobro && Number.isFinite(Date.parse(c.fechaCobro)) && c.saldoCuota !== null && c.saldoCuota <= 0)
      : !(c.fechaCobro === null && c.saldoCuota !== null && c.saldoCuota > 0))))
      throw new AdministrativeCorrectionError("Las cuotas de Vimarx no permiten confirmar esa resolución. Revisá el cobro completo antes de conciliar.");
    await this.locked(id, async (tx, s) => {
      const { g, operation: current } = this.pending(s, input.operationId);
      const actor = await tx.user.findFirst({ where: { id: user.id, isSystemAdmin: true, state: 1, deletedAt: null } });
      if (!actor) throw new AdministrativeCorrectionError("Se requiere un administrador activo.", 403);
      if (s.updatedAt.toISOString() !== input.expectedUpdatedAt || before.updatedAt.getTime() !== s.updatedAt.getTime())
        throw new AdministrativeCorrectionError("La solicitud cambió durante la conciliación. Actualizá el detalle.");
      if (!input.reason.trim() || input.reason.trim().length < 10)
        throw new AdministrativeCorrectionError("Indicá el motivo y la evidencia de la conciliación.", 400);
      if (current.response && (!applied || input.cobroId !== current.response.cobroId || input.totalCobrado !== current.response.totalCobrado))
        throw new AdministrativeCorrectionError("La resolución no coincide con la respuesta de cobro registrada.");
      if (applied) await this.appendCharge(tx, s, current, { cobroId: input.cobroId, totalCobrado: input.totalCobrado, nrosCuota: current.nrosCuota });
      const rest = { ...control(s) }; delete rest.generationPending;
      await tx.solicitud.update({ where: { id }, data: { administrativeCoreControl: rest } });
      await this.audit(tx, s, user.id, "REFINANCIACION_COBRO_RECOVERED", { ...input, requestId: g.requestId, prestamoId: current.prestamoId, nrosCuota: current.nrosCuota }, input.reason.trim());
    });
    return this.inspect(id, user);
  }
}
