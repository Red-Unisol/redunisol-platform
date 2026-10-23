import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { AdministrativeCorrectionService, applyAdministrativeCorrection, administrativeSource } from "./AdministrativeCorrectionService";
import { ADMIN_CORRECTION_ACTION, coreReconciliationPending } from "../../domain/workflow/AdministrativeCorrection";
import { SolicitudWorkflowPrismaDatasource } from "../datasources/SolicitudWorkflowPrismaDatasource";
import { SolicitudWorkflowEngine } from "../../domain/workflow/SolicitudWorkflowEngine";
import { actingContext } from "../../../auth/impersonation/context";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";

const enabled = Boolean(process.env.BEEX_TEST_DATABASE_URL);
const db = new PrismaClient({ datasourceUrl: process.env.BEEX_TEST_DATABASE_URL });
after(() => db.$disconnect());

async function fixture() {
  const url = new URL(process.env.BEEX_TEST_DATABASE_URL!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_test"), "Only an explicit local *_test database is allowed");
  const admin = await db.user.create({ data: { email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", isSystemAdmin: true } });
  const state = await db.workflowState.findUniqueOrThrow({ where: { code: "Confirmada" } });
  const s = await db.solicitud.create({ data: {
    createdBy: admin.id, assignedToUserId: admin.id, ejecutivoSolicitud: "Ejecutivo original",
    estadoActualId: state.id, legacyOid: randomUUID(), lineaPrestamoLegacyOid: "55", lineaPrestamoDescripcion: "Línea",
    montoAFinanciar: 600000, montoAprobadoRiesgo: 600000, cuotas: 12, linkFirmaDigital: "https://example.test/firma-original",
    titular: { create: { nroDocumento: "12345678" } },
  } });
  const actor = { ...admin, workflowOwner: null } as unknown as AuthUser;
  const command = { actionCode: ADMIN_CORRECTION_ACTION, changedBy: admin.id, isSystemAdmin: true,
    workflowOwnerId: "", solicitudId: s.id, now: new Date(), comment: "Confirmada por error de operación",
    administrativeCorrection: { requestId: randomUUID(), expectedUpdatedAt: s.updatedAt.toISOString() } };
  const engine = new SolicitudWorkflowEngine({ repository: new SolicitudWorkflowPrismaDatasource(db) });
  const service = new AdministrativeCorrectionService({ db,
    changeState: { execute: input => engine.execute({ ...command, ...input, changedBy: input.currentUser.id,
      isSystemAdmin: input.currentUser.isSystemAdmin, workflowOwnerId: input.currentUser.workflowOwnerId }) },
    loanSnapshot: async () => ({ id: s.legacyOid!, estado: 0, amount: 600000, cuotas: 12, lineaId: "77", primerVencimiento: null, cancelacionesCentavos: 0 }),
    lineResolver: { resolveByPresolicitudOid: async () => ({ id: "77", codigoMutual: null }) },
  });
  const clean = async () => {
    await db.solicitudEstadoHistorial.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitud.delete({ where: { id: s.id } });
    await db.user.delete({ where: { id: admin.id } });
  };
  return { s, actor, command, engine, service, clean };
}

it("administrative engine path preserves links, assignment and history; reconciliation blocks changed conditions", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await f.engine.execute(f.command);
    const corrected = await administrativeSource(db, f.s.id);
    assert.equal(corrected.estadoActual.code, "Revisar");
    assert.equal(corrected.legacyOid, f.s.legacyOid);
    assert.equal(corrected.assignedToUserId, f.s.assignedToUserId);
    assert.equal(corrected.linkFirmaDigital, f.s.linkFirmaDigital);
    assert.equal(String(corrected.montoAprobadoRiesgo), "600000");
    assert(coreReconciliationPending(corrected));
    const history = await db.solicitudEstadoHistorial.findMany({ where: { solicitudId: f.s.id } });
    assert.equal(history.length, 1);
    assert.equal(history[0]!.transitionId, null);
    assert.equal(history[0]!.realActorUserId, f.actor.id);
    assert.equal(history[0]!.toOwnerCodeSnapshot, "VENDEDORES");
    const transitions = await db.workflowTransition.count({ where: { fromStateId: f.s.estadoActualId, toState: { code: "Revisar" } } });
    assert.equal(transitions, 0);
    await assert.rejects(() => f.engine.execute(f.command));
    await f.service.reconcile(f.s.id, f.actor, { expectedUpdatedAt: corrected.updatedAt.toISOString(), reason: "Préstamo revisado y condiciones verificadas" });
    assert(!coreReconciliationPending(await administrativeSource(db, f.s.id)));
    await db.solicitud.update({ where: { id: f.s.id }, data: { cuotas: 24 } });
    assert(coreReconciliationPending(await administrativeSource(db, f.s.id)));
    const current = await administrativeSource(db, f.s.id);
    await assert.rejects(() => f.service.reconcile(f.s.id, f.actor, { expectedUpdatedAt: current.updatedAt.toISOString(), reason: "No debe aceptar diferencias de cuotas" }), /no coinciden/);
    await db.solicitud.update({ where: { id: f.s.id }, data: { estadoActualId: f.s.estadoActualId } });
    await assert.rejects(() => f.engine.execute({ ...f.command, actionCode: "liquidar", administrativeCorrection: undefined }), /conciliar/);
  } finally { await f.clean(); }
});

it("two concurrent corrections produce exactly one event", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.engine.execute(f.command), f.engine.execute({
      ...f.command, administrativeCorrection: { ...f.command.administrativeCorrection, requestId: randomUUID() },
    })]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(await db.solicitudEstadoHistorial.count({ where: { solicitudId: f.s.id } }), 1);
  } finally { await f.clean(); }
});

it("a reservation prevents correction; an unlinked request needs no Core reconciliation", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await db.transferenciaDesembolso.create({ data: {
      solicitudId: f.s.id, prestamoLegacyId: f.s.legacyOid!, idempotencyKey: randomUUID(),
      reservationHash: "test", planVersion: "1", plan: {}, clientId: "test", installationId: "test", operator: "test",
    } });
    await assert.rejects(() => f.engine.execute(f.command), /reserva de desembolso/);
    await db.transferenciaDesembolso.deleteMany({ where: { solicitudId: f.s.id } });
    const s = await db.solicitud.update({ where: { id: f.s.id }, data: { legacyOid: null } });
    await f.engine.execute({ ...f.command, administrativeCorrection: {
      ...f.command.administrativeCorrection, expectedUpdatedAt: s.updatedAt.toISOString(),
    } });
    assert(!coreReconciliationPending(await administrativeSource(db, f.s.id)));
  } finally {
    await db.transferenciaDesembolso.deleteMany({ where: { solicitudId: f.s.id } });
    await f.clean();
  }
});

it("unauthorized, stale, downstream and payment cases are rejected without changing state", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.engine.execute({ ...f.command, isSystemAdmin: false }));
    await assert.rejects(() => f.engine.execute({ ...f.command, administrativeCorrection: { ...f.command.administrativeCorrection, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" } }));
    await db.solicitudEstadoHistorial.create({ data: { solicitudId: f.s.id, estadoNuevoId: f.s.estadoActualId, toStateCodeSnapshot: "Liquidada", toStateNameSnapshot: "Liquidada" } });
    await assert.rejects(() => f.engine.execute(f.command), /recorrió etapas/);
    await db.solicitudEstadoHistorial.deleteMany({ where: { solicitudId: f.s.id } });
    await actingContext.run({ administrator: f.actor, selectedUser: f.actor, sessionId: "test", auditId: "test" }, async () => {
      await assert.rejects(() => f.engine.execute(f.command), /propia sesión/);
    });
    assert.equal((await administrativeSource(db, f.s.id)).estadoActualId, f.s.estadoActualId);
    // A duplicate audit ID fails after update: the surrounding transaction must
    // roll back the state, control and risk cap together.
    await db.solicitudEstadoHistorial.create({ data: { id: f.command.administrativeCorrection.requestId, solicitudId: f.s.id,
      estadoNuevoId: f.s.estadoActualId, toStateCodeSnapshot: "Confirmada", toStateNameSnapshot: "Confirmada" } });
    await assert.rejects(() => db.$transaction(tx => applyAdministrativeCorrection(tx, f.command)));
    const untouched = await administrativeSource(db, f.s.id);
    assert.equal(untouched.estadoActualId, f.s.estadoActualId);
    assert.equal(untouched.administrativeCoreControl, null);
  } finally { await f.clean(); }
});
