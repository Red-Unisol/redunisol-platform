import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, it } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { SolicitudWorkflowPrismaDatasource } from "../datasources/SolicitudWorkflowPrismaDatasource";
import { SolicitudWorkflowEngine } from "../../domain/workflow/SolicitudWorkflowEngine";
import { SolicitudWorkflowPlanBuilder } from "../../domain/workflow/SolicitudWorkflowPlanBuilder";
import { REVERSE_DISMISSAL_ACTION } from "../../domain/workflow/Dismissal";
import { actingContext } from "../../../auth/impersonation/context";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import type { CoreLoanLifecycle } from "./ControlledLoanReplacementService";

const enabled = Boolean(process.env.BEEX_TEST_DATABASE_URL);
const db = new PrismaClient({ datasourceUrl: process.env.BEEX_TEST_DATABASE_URL });
after(() => db.$disconnect());

const cancelled: CoreLoanLifecycle = {
  id: "verified-loan", account: "100", estado: 3, estadoLabel: "Anulada",
  estadoPrestamo: 0, estadoPrestamoLabel: "Anulado", vigente: false, saldo: 0,
};

async function fixture(code = "Confirmada", linked = true) {
  const url = new URL(process.env.BEEX_TEST_DATABASE_URL!);
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"));
  const state = await db.workflowState.findUniqueOrThrow({ where: { code } });
  const admin = await db.user.create({ data: {
    email: randomUUID() + "@example.test", legacyUser: randomUUID(), passwordHash: "test",
    isSystemAdmin: true, workflowOwnerId: state.ownerId,
  } });
  const s = await db.solicitud.create({ data: {
    createdBy: admin.id, assignedToUserId: admin.id, ejecutivoSolicitud: "Ejecutivo original",
    estadoActualId: state.id, legacyOid: linked ? randomUUID() : null,
    lineaPrestamoLegacyOid: "55", lineaPrestamoDescripcion: "Línea ficticia",
    montoAFinanciar: 600000, montoAprobadoRiesgo: 550000, cuotas: 12,
    analisisFinalizadoAt: new Date("2026-10-30T12:00:00Z"), analisisFinalizadoBy: admin.id,
    linkFirmaDigital: "https://example.test/firma-original",
  } });
  let loan: CoreLoanLifecycle | null = { ...cancelled };
  let failure = false;
  const datasource = new SolicitudWorkflowPrismaDatasource(db, undefined, async () => {
    if (failure) throw new Error("Vimarx unavailable");
    return loan;
  });
  const engine = new SolicitudWorkflowEngine({ repository: datasource });
  const command = { actionCode: "desestimar", changedBy: admin.id, isSystemAdmin: true,
    workflowOwnerId: state.ownerId, solicitudId: s.id, now: new Date(), comment: "No continuar con la solicitud" };
  const reverse = { ...command, actionCode: REVERSE_DISMISSAL_ACTION, comment: "Se desestimó por error; restaurar el estado anterior" };
  const current = () => db.solicitud.findUniqueOrThrow({ where: { id: s.id }, include: { estadoActual: true } });
  const history = () => db.solicitudEstadoHistorial.findMany({ where: { solicitudId: s.id } });
  const clean = async () => {
    await db.solicitudEstadoHistorial.deleteMany({ where: { solicitudId: s.id } });
    await db.transferenciaDesembolso.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitud.delete({ where: { id: s.id } });
    await db.user.delete({ where: { id: admin.id } });
  };
  return { s, admin, datasource, engine, command, reverse, current, history, clean,
    setLoan: (value: CoreLoanLifecycle | null) => { loan = value; },
    fail: () => { failure = true; } };
}

it("every active origin dismisses and restores exactly its prior state, without Motor or assignment side effects", { skip: !enabled }, async () => {
  const origins = await db.workflowState.findMany({ where: { isActive: true, code: { not: "Desestimada" } } });
  assert.equal(origins.length, 12);
  for (const state of origins) {
    const f = await fixture(state.code);
    try {
      const result = await f.engine.execute(f.command);
      assert.equal(result.solicitud.estadoActual.code, "Desestimada", state.code);
      const dismissed = await f.current();
      const event = (await f.history())[0]!;
      assert.equal(dismissed.desestimacionHistorialId, event.id);
      assert.equal(event.estadoAnteriorId, state.id);
      assert.equal(event.changedBy, f.admin.id);
      assert.equal(event.realActorUserId, f.admin.id);
      assert.equal((event.metadata as Prisma.JsonObject).verifiedLoanId, "verified-loan");
      assert.equal(result.transitions.length, 1);
      assert.equal(result.transitions[0]!.toState.code, state.code);
      assert.equal(result.transitions[0]!.requiresComment, true);
      assert.deepEqual(await f.datasource.listAvailableTransitions({
        solicitudId: f.s.id, workflowOwnerId: state.ownerId, isSystemAdmin: false,
      }), []);
      await assert.rejects(f.engine.execute({ ...f.reverse, isSystemAdmin: false }));
      await assert.rejects(f.engine.execute({ ...f.reverse, comment: "" }));
      // A same-state history event cannot change which dismissal is reversed.
      await db.solicitudEstadoHistorial.create({ data: {
        solicitudId: f.s.id, estadoAnteriorId: dismissed.estadoActualId, estadoNuevoId: dismissed.estadoActualId,
        toStateCodeSnapshot: "Desestimada", toStateNameSnapshot: "Desestimada", actionCode: "ASSIGNMENT_SET",
      } });
      await f.engine.execute(f.reverse);
      const restored = await f.current();
      assert.equal(restored.estadoActualId, f.s.estadoActualId, state.code);
      assert.equal(restored.desestimacionHistorialId, null);
      assert.equal(restored.assignedToUserId, f.s.assignedToUserId);
      assert.equal(restored.legacyOid, f.s.legacyOid);
      assert.equal(restored.linkFirmaDigital, f.s.linkFirmaDigital);
      assert.equal(String(restored.montoAprobadoRiesgo), String(f.s.montoAprobadoRiesgo));
      assert.equal(restored.analisisFinalizadoAt?.toISOString(), f.s.analisisFinalizadoAt?.toISOString());
      assert.equal(restored.analisisFinalizadoBy, f.s.analisisFinalizadoBy);
      const audit = (await f.history()).find(h => h.actionCode === REVERSE_DISMISSAL_ACTION)!;
      assert.equal(audit.estadoAnteriorId, dismissed.estadoActualId);
      assert.equal(audit.estadoNuevoId, state.id);
      assert.equal(audit.comentario, f.reverse.comment);
      assert.equal((audit.metadata as Prisma.JsonObject).reversedHistoryId, event.id);
      assert.equal(audit.transitionId, null);
      await assert.rejects(f.engine.execute(f.reverse));
    } finally { await f.clean(); }
  }
});

it("a recorded external payment blocks even with an authoritatively cancelled loan", { skip: !enabled }, async () => {
  const f = await fixture("Pagada");
  try {
    // External payments are immutable, including in tests. Roll the fixture
    // back as a whole instead of weakening the database's audit protection.
    const rollback = new Error("rollback payment fixture");
    await assert.rejects(db.$transaction(async tx => {
      const receipt = await tx.solicitudAdjunto.create({ data: { solicitudId: f.s.id, archivoNombre: "pago-ficticio.pdf" } });
      const payment = await tx.solicitudPagoExterno.create({ data: {
        id: randomUUID(), solicitudId: f.s.id, paidOn: new Date("2026-11-01"),
        reference: "Pago ficticio", receiptSha256: "test", adjuntoId: receipt.id, recordedBy: f.admin.id,
      } });
      const engine = new SolicitudWorkflowEngine({ repository: new SolicitudWorkflowPrismaDatasource(db, tx, async () => cancelled) });
      await assert.rejects(engine.execute(f.command), /pago registrado/);
      assert.equal((await tx.solicitud.findUniqueOrThrow({ where: { id: f.s.id } })).estadoActualId, f.s.estadoActualId);
      assert.equal(await tx.solicitudEstadoHistorial.count({ where: { solicitudId: f.s.id } }), 0);
      assert.equal((await tx.solicitudPagoExterno.findUniqueOrThrow({ where: { id: payment.id } })).reference, payment.reference);
      throw rollback;
    }), error => error === rollback);
  } finally { await f.clean(); }
});

it("historical backfill recovers only an unambiguous last dismissal, ignoring same-state audit events", { skip: !enabled }, async () => {
  const f = await fixture("Revisar");
  try {
    await f.engine.execute(f.command);
    const event = (await f.history())[0]!;
    const backfill = "WITH latest" + readFileSync("prisma/migrations/20261103120000_dismissal_and_exact_reversal/migration.sql", "utf8").split("WITH latest")[1]!;
    await db.solicitud.update({ where: { id: f.s.id }, data: { desestimacionHistorialId: null } });
    await db.solicitudEstadoHistorial.create({ data: {
      solicitudId: f.s.id, estadoAnteriorId: event.estadoNuevoId, estadoNuevoId: event.estadoNuevoId,
      toStateCodeSnapshot: "Desestimada", toStateNameSnapshot: "Desestimada",
      actionCode: "ASSIGNMENT_SET", changedAt: new Date(event.changedAt.getTime() + 1000),
    } });
    await db.$executeRawUnsafe(backfill);
    assert.equal((await f.current()).desestimacionHistorialId, event.id);
    // Two different state changes at the latest timestamp are ambiguous.
    await db.solicitud.update({ where: { id: f.s.id }, data: { desestimacionHistorialId: null } });
    await db.solicitudEstadoHistorial.create({ data: {
      solicitudId: f.s.id, estadoAnteriorId: event.estadoNuevoId, estadoNuevoId: f.s.estadoActualId,
      toStateCodeSnapshot: "Revisar", toStateNameSnapshot: "Revisar",
      actionCode: "historical-event", changedAt: event.changedAt,
    } });
    await db.$executeRawUnsafe(backfill);
    assert.equal((await f.current()).desestimacionHistorialId, null);
    await assert.rejects(f.engine.execute(f.reverse));
  } finally { await f.clean(); }
});

it("an active, unknown, partially cancelled or unreachable loan blocks dismissal atomically", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const invalid = [
      null, { ...cancelled, id: null }, { ...cancelled, estadoLabel: "Activa" },
      { ...cancelled, estadoPrestamoLabel: "Pendiente" }, { ...cancelled, vigente: true },
      { ...cancelled, saldo: 1 }, { ...cancelled, saldo: null },
    ];
    for (const loan of invalid) {
      f.setLoan(loan);
      await assert.rejects(f.engine.execute(f.command), /anulado/);
      assert.equal((await f.current()).estadoActualId, f.s.estadoActualId);
      assert.equal((await f.history()).length, 0);
    }
    f.fail();
    await assert.rejects(f.engine.execute(f.command), /verificar la anulación/);
    assert.equal((await f.history()).length, 0);
  } finally { await f.clean(); }
});

it("unlinked pre-liquidation requests need no Core read; downstream requests cannot invent a missing loan", { skip: !enabled }, async () => {
  const early = await fixture("CargaVendedor", false);
  try {
    early.fail();
    await early.engine.execute(early.command);
    await early.engine.execute(early.reverse);
    await db.solicitudEstadoHistorial.create({ data: {
      solicitudId: early.s.id, estadoAnteriorId: early.s.estadoActualId, estadoNuevoId: early.s.estadoActualId,
      actionCode: "historical-liquidation", toStateCodeSnapshot: "Liquidada", toStateNameSnapshot: "Liquidada",
    } });
    await assert.rejects(early.engine.execute(early.command), /no tiene un préstamo/);
  } finally { await early.clean(); }
  const late = await fixture("Liquidada", false);
  try {
    await assert.rejects(late.engine.execute(late.command), /no tiene un préstamo/);
    assert.equal((await late.history()).length, 0);
  } finally { await late.clean(); }
});

it("pending generation, pending replacement, archived requests and transfer reservations block dismissal", { skip: !enabled }, async () => {
  const f = await fixture("Transferir");
  try {
    for (const data of [
      { administrativeCoreControl: { generationPending: { status: "UNCERTAIN" } } },
      { administrativeCoreControl: { replacementPending: { status: "CREATING" } } },
      { archivedAt: new Date(), administrativeCoreControl: Prisma.DbNull },
    ]) {
      await db.solicitud.update({ where: { id: f.s.id }, data });
      await assert.rejects(f.engine.execute(f.command));
    }
    await db.solicitud.update({ where: { id: f.s.id }, data: { archivedAt: null } });
    await db.transferenciaDesembolso.create({ data: {
      solicitudId: f.s.id, prestamoLegacyId: f.s.legacyOid!, idempotencyKey: randomUUID(),
      reservationHash: "test", planVersion: "1", plan: {}, clientId: "test", installationId: "test", operator: "test",
    } });
    await assert.rejects(f.engine.execute(f.command), /reserva de transferencia/);
    assert.equal((await f.current()).estadoActualId, f.s.estadoActualId);
    assert.equal((await f.history()).length, 0);
  } finally { await f.clean(); }
});

it("concurrent dismissals and concurrent reversals each produce only one state change", { skip: !enabled }, async () => {
  const f = await fixture("PreAprobada");
  try {
    const dismissed = await Promise.allSettled([f.engine.execute(f.command), f.engine.execute(f.command)]);
    assert.equal(dismissed.filter(r => r.status === "fulfilled").length, 1);
    const reversed = await Promise.allSettled([f.engine.execute(f.reverse), f.engine.execute(f.reverse)]);
    assert.equal(reversed.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await f.history()).length, 2);
    assert.equal((await f.current()).estadoActualId, f.s.estadoActualId);
  } finally { await f.clean(); }
});

it("stale plans, a different dismissal cycle, inactive destinations and impersonation never restore", { skip: !enabled }, async () => {
  const f = await fixture("Revisar");
  try {
    await f.engine.execute(f.command);
    const context = await f.datasource.getTransitionValidationContext({ actionCode: REVERSE_DISMISSAL_ACTION, solicitudId: f.s.id });
    const plan = new SolicitudWorkflowPlanBuilder().build(f.reverse, { command: f.reverse, transitionValidation: context });
    await db.solicitud.update({ where: { id: f.s.id }, data: { updatedAt: new Date(Date.now() + 1000) } });
    await assert.rejects(f.datasource.executeWorkflowPlan({ plan }));
    const actor = { ...f.admin, workflowOwner: null } as unknown as AuthUser;
    await actingContext.run({ administrator: actor, selectedUser: actor, sessionId: randomUUID(), auditId: randomUUID() }, async () => {
      await assert.rejects(f.engine.execute(f.reverse), /propia sesión/);
      assert.deepEqual(await f.datasource.listAvailableTransitions({ solicitudId: f.s.id, workflowOwnerId: f.admin.workflowOwnerId!, isSystemAdmin: true }), []);
    });
    await f.engine.execute(f.reverse);
    await f.engine.execute(f.command);
    await assert.rejects(f.datasource.executeWorkflowPlan({ plan }));
    const pointer = (await f.current()).desestimacionHistorialId;
    await db.solicitud.update({ where: { id: f.s.id }, data: { desestimacionHistorialId: null } });
    await assert.rejects(f.engine.execute(f.reverse));
    await db.solicitud.update({ where: { id: f.s.id }, data: { desestimacionHistorialId: pointer } });
    const inactive = await db.workflowState.create({ data: { code: randomUUID(), name: "Inactivo ficticio",
      ownerId: f.admin.workflowOwnerId!, isActive: false } });
    try {
      await db.solicitudEstadoHistorial.update({ where: { id: pointer! }, data: { estadoAnteriorId: inactive.id } });
      await assert.rejects(f.engine.execute(f.reverse));
      assert.equal((await f.current()).estadoActual.code, "Desestimada");
    } finally {
      await db.solicitudEstadoHistorial.update({ where: { id: pointer! }, data: { estadoAnteriorId: f.s.estadoActualId } });
      await db.workflowState.delete({ where: { id: inactive.id } });
    }
  } finally { await f.clean(); }
});

it("a failed reversal audit rolls back its state update and preserves the dismissal pointer", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await f.engine.execute(f.command);
    const dismissed = await f.current();
    await assert.rejects(db.$transaction(async tx => {
      const failing = new Proxy(tx, { get(target, property) {
        if (property !== "solicitudEstadoHistorial") return Reflect.get(target, property);
        return new Proxy(target.solicitudEstadoHistorial, { get(delegate, method) {
          if (method === "create") return async () => { throw new Error("audit unavailable"); };
          return Reflect.get(delegate, method);
        } });
      } });
      await new SolicitudWorkflowEngine({ repository: new SolicitudWorkflowPrismaDatasource(db, failing) }).execute(f.reverse);
    }), /audit unavailable/);
    assert.equal((await f.current()).estadoActualId, dismissed.estadoActualId);
    assert.equal((await f.current()).desestimacionHistorialId, dismissed.desestimacionHistorialId);
    assert.equal((await f.history()).length, 1);
  } finally { await f.clean(); }
});
