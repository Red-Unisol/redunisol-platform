import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { ControlledLoanReplacementService } from "./ControlledLoanReplacementService";
import { AdministrativeCorrectionService, administrativeSource } from "./AdministrativeCorrectionService";
import { coreReconciliationPending } from "../../domain/workflow/AdministrativeCorrection";
import { SolicitudWorkflowPrismaDatasource } from "../datasources/SolicitudWorkflowPrismaDatasource";
import { SolicitudesCorePrismaDatasource } from "../datasources/SolicitudesCorePrismaDatasource";
import { SolicitudCancelacionesPrismaDatasource } from "../../cancelaciones/infrastructure/datasources/SolicitudCancelacionesPrismaDatasource";
import { actingContext } from "../../../auth/impersonation/context";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";

const enabled = Boolean(process.env.BEEX_TEST_DATABASE_URL);
const db = new PrismaClient({ datasourceUrl: process.env.BEEX_TEST_DATABASE_URL });
after(() => db.$disconnect());
async function fixture() {
  const url = new URL(process.env.BEEX_TEST_DATABASE_URL!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_test"));
  const admin = await db.user.create({ data: { email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", isSystemAdmin: true } });
  const state = await db.workflowState.findUniqueOrThrow({ where: { code: "Revisar" } });
  const s = await db.solicitud.create({ data: {
    createdBy: admin.id, assignedToUserId: admin.id, estadoActualId: state.id,
    legacyOid: "443417", lineaPrestamoLegacyOid: "55", lineaPrestamoCodigoMutual: "amejuca", lineaPrestamoDescripcion: "Línea",
    montoAFinanciar: 600000, cuotas: 12, linkFirmaDigital: "https://example.test/old-signature",
    administrativeCoreControl: { correctionId: randomUUID(), loanId: "443417", reconciledFingerprint: null },
    titular: { create: { nroDocumento: "12345678" } },
    cancelaciones: { create: { cuentaADebitar: "x", cbu: "x", cuentaBancaria: "x", socio: "Titular", monto: 10000 } },
  }, include: { cancelaciones: true } });
  const actor = { ...admin, workflowOwner: null } as unknown as AuthUser;
  const newId = String(Date.now()) + String(Math.floor(Math.random() * 100000));
  let calls = 0;
  const deps: ConstructorParameters<typeof ControlledLoanReplacementService>[0] = {
    db, creationTimeoutMs: 50,
    prepare: { prepareReplacement: async () => ({ solicitud: null as unknown as SolicitudCore, codigoMutual: "amejuca", coreInput: {
      cuotas: 12, fechaEmision: "2026-10-23", integrantes: [{ socio: "90", tipoRelacion: "Titular" }],
      lineaPrestamo: "77", montoDeseado: 600000, nroLote: 1000000, vendedor: "5",
    } }) },
    gateway: { crear: async () => { calls++; return { id: newId }; } },
    lifecycle: async () => ({ id: "443417", account: "1016127", estado: 3, estadoLabel: "Anulada", estadoPrestamo: 0, estadoPrestamoLabel: "Anulado", vigente: false, saldo: 0 }),
    loanSnapshot: async (id, doc) => { assert.equal(doc, "12345678"); return { id, estado: 0, amount: 600000, cuotas: 12, lineaId: "77", primerVencimiento: null, cancelacionesCentavos: 1000000 }; },
    makeSignatureLink: id => `https://example.test/new-signature?sol=${id}`,
  };
  const service = new ControlledLoanReplacementService(deps);
  const input = { requestId: randomUUID(), expectedUpdatedAt: s.updatedAt.toISOString(), previousLoanId: "443417", reason: "Corregir monto luego de anulación confirmada" };
  const clean = async () => {
    await db.solicitudPrestamoReplacement.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitudEstadoHistorial.deleteMany({ where: { solicitudId: s.id } });
    await db.transferenciaDesembolso.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitud.delete({ where: { id: s.id } });
    await db.user.delete({ where: { id: admin.id } });
  };
  return { s, actor, deps, service, input, newId, calls: () => calls, clean };
}

it("reserves before Core creation, atomically replaces the active link and preserves traceability; retries are idempotent", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const create = f.deps.gateway.crear;
    f.deps.gateway.crear = async input => {
      const pending = await administrativeSource(db, f.s.id);
      assert.equal(pending.legacyOid, "443417");
      assert.equal(pending.linkFirmaDigital, f.s.linkFirmaDigital);
      assert.equal((pending.administrativeCoreControl as { replacementPending: string }).replacementPending, f.input.requestId);
      assert.equal((await db.solicitudPrestamoReplacement.findUniqueOrThrow({ where: { id: f.input.requestId } })).status, "CREATING");
      return create(input);
    };
    await f.service.replace(f.s.id, f.actor, f.input);
    const s = await administrativeSource(db, f.s.id);
    assert.equal(s.legacyOid, f.newId);
    assert.equal(s.linkFirmaDigital, `https://example.test/new-signature?sol=${f.newId}`);
    assert.equal(s.assignedToUserId, f.actor.id);
    assert.equal(s.estadoActual.code, "Revisar");
    assert.equal(String(s.montoAFinanciar), "600000");
    assert(coreReconciliationPending(s));
    const op = await db.solicitudPrestamoReplacement.findUniqueOrThrow({ where: { id: f.input.requestId } });
    assert.equal(op.status, "LINKED"); assert.equal(op.previousLoanId, "443417"); assert.equal(op.newLoanId, f.newId);
    assert.equal((op.previousSnapshot as { signatureLink: string }).signatureLink, f.s.linkFirmaDigital);
    assert.equal(op.actorId, f.actor.id); assert.equal(op.reason, f.input.reason);
    const history = await db.solicitudEstadoHistorial.findMany({ where: { solicitudId: f.s.id } });
    assert.deepEqual(history.map(h => h.actionCode).sort(), ["ADMIN_LOAN_REPLACED", "ADMIN_LOAN_REPLACEMENT_STARTED"]);
    assert(history.every(h => h.realActorUserId === f.actor.id && h.estadoAnteriorId === h.estadoNuevoId));
    await f.service.replace(f.s.id, f.actor, f.input);
    assert.equal(f.calls(), 1);
  } finally { await f.clean(); }
});

it("a timeout freezes edits and cancellations, blocks duplicate creation and recovers only a verified existing loan", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const create = f.deps.gateway.crear;
    f.deps.gateway.crear = async input => { await create(input); throw new Error("timeout after remote creation"); };
    await assert.rejects(() => f.service.replace(f.s.id, f.actor, f.input), /no confirmó/);
    assert.equal((await administrativeSource(db, f.s.id)).legacyOid, "443417");
    const op = await db.solicitudPrestamoReplacement.findUniqueOrThrow({ where: { id: f.input.requestId } });
    assert.equal(op.status, "UNCERTAIN");
    await assert.rejects(() => f.service.replace(f.s.id, f.actor, f.input), /No lo repitas/);
    const pending = await administrativeSource(db, f.s.id);
    assert.deepEqual(await new SolicitudWorkflowPrismaDatasource(db).listAvailableTransitions({ solicitudId: f.s.id, workflowOwnerId: "", isSystemAdmin: true }), []);
    await assert.rejects(() => f.service.replace(f.s.id, f.actor, { ...f.input, requestId: randomUUID(), expectedUpdatedAt: pending.updatedAt.toISOString() }), /reemplazo/);
    await assert.rejects(() => new SolicitudesCorePrismaDatasource(db).update(f.s.id, { solicitud: { montoAFinanciar: 700000 } }, { expectedEstadoActualId: f.s.estadoActualId, enforceMontoAprobadoRiesgo: false }), /reemplazo/);
    const cancellations = new SolicitudCancelacionesPrismaDatasource(db);
    await assert.rejects(() => cancellations.update({ cancelacionId: f.s.cancelaciones[0]!.id, monto: 20000 }), /reemplazo/);
    await assert.rejects(() => cancellations.softDelete({ cancelacionId: f.s.cancelaciones[0]!.id, deletedAt: new Date(), deletedBy: f.actor.id }), /reemplazo/);
    await assert.rejects(() => cancellations.create({ cancelacionId: randomUUID(), solicitudId: f.s.id, cuentaADebitar: "x", cbu: "x", cuentaBancaria: "x", socio: "x", socioLegacyId: null, monto: 1, notas: null, createdBy: f.actor.id }), /reemplazo/);
    const recovery = { requestId: f.input.requestId, expectedUpdatedAt: pending.updatedAt.toISOString(), newLoanId: f.newId, reason: "Préstamo confirmado manualmente en Vimarx" };
    const snapshot = f.deps.loanSnapshot;
    f.deps.loanSnapshot = async (id, doc) => ({ ...(await snapshot(id, doc))!, amount: 700000 });
    await assert.rejects(() => f.service.recover(f.s.id, f.actor, recovery), /no coincide/);
    f.deps.loanSnapshot = snapshot;
    await f.service.recover(f.s.id, f.actor, recovery);
    assert.equal((await administrativeSource(db, f.s.id)).legacyOid, f.newId);
    assert.equal(f.calls(), 1);
    assert.equal(await db.solicitudEstadoHistorial.count({ where: { solicitudId: f.s.id, actionCode: "ADMIN_LOAN_REPLACEMENT_RECOVERED" } }), 1);
  } finally { await f.clean(); }
});

it("concurrent operators can make only one external call", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.service.replace(f.s.id, f.actor, f.input), f.service.replace(f.s.id, f.actor, { ...f.input, requestId: randomUUID() })]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(f.calls(), 1);
    assert.equal(await db.solicitudPrestamoReplacement.count({ where: { solicitudId: f.s.id } }), 1);
  } finally { await f.clean(); }
});

it("rejects non-admins, impersonation, stale forms, active loans and downstream cases before creating", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.service.replace(f.s.id, { ...f.actor, isSystemAdmin: false }, f.input), /administrador/);
    await actingContext.run({ administrator: f.actor, selectedUser: f.actor, sessionId: "test", auditId: "test" }, async () => {
      await assert.rejects(() => f.service.replace(f.s.id, f.actor, f.input), /propia sesión/);
    });
    await assert.rejects(() => f.service.replace(f.s.id, f.actor, { ...f.input, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }), /cambió/);
    const lifecycle = f.deps.lifecycle;
    f.deps.lifecycle = async id => ({ ...(await lifecycle(id))!, estadoLabel: "Activa" });
    await assert.rejects(() => f.service.replace(f.s.id, f.actor, f.input), /anulado/);
    f.deps.lifecycle = lifecycle;
    await db.solicitudEstadoHistorial.create({ data: { solicitudId: f.s.id, estadoNuevoId: f.s.estadoActualId, toStateCodeSnapshot: "Liquidada", toStateNameSnapshot: "Liquidada" } });
    await assert.rejects(() => f.service.replace(f.s.id, f.actor, f.input), /antecedentes/);
    assert.equal(f.calls(), 0);
    assert.equal(await db.solicitudPrestamoReplacement.count({ where: { solicitudId: f.s.id } }), 0);
  } finally { await f.clean(); }
});

it("a known Core ID survives a linking failure and can be safely finalized without another creation", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const makeLink = f.deps.makeSignatureLink;
    f.deps.makeSignatureLink = () => { throw new Error("local link failure"); };
    await assert.rejects(() => f.service.replace(f.s.id, f.actor, f.input), /local link failure/);
    const op = await db.solicitudPrestamoReplacement.findUniqueOrThrow({ where: { id: f.input.requestId } });
    assert.equal(op.status, "CREATED"); assert.equal(op.newLoanId, f.newId);
    assert.equal((await administrativeSource(db, f.s.id)).legacyOid, "443417");
    f.deps.makeSignatureLink = makeLink;
    await f.service.replace(f.s.id, f.actor, f.input);
    assert.equal(f.calls(), 1);
    assert.equal((await administrativeSource(db, f.s.id)).legacyOid, f.newId);
  } finally { await f.clean(); }
});

it("Core reconciliation rejects an annulled loan even when its financial inputs match", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const service = new AdministrativeCorrectionService({ db, changeState: { execute: async () => { throw new Error("unused"); } },
      loanSnapshot: async (id, doc) => ({ ...(await f.deps.loanSnapshot(id, doc))!, estado: 3 }),
      lineResolver: { resolveByPresolicitudOid: async () => ({ id: "77", codigoMutual: "amejuca" }) },
    });
    await assert.rejects(() => service.reconcile(f.s.id, f.actor, { expectedUpdatedAt: f.s.updatedAt.toISOString(), reason: "Verificar préstamo anterior anulado" }), /activo/);
    assert(coreReconciliationPending(await administrativeSource(db, f.s.id)));
  } finally { await f.clean(); }
});

it("a returned ID already linked to another request is preserved for investigation without stealing its link or retrying creation", { skip: !enabled }, async () => {
  const f = await fixture();
  const other = await db.solicitud.create({ data: { createdBy: f.actor.id, estadoActualId: f.s.estadoActualId, legacyOid: f.newId, lineaPrestamoLegacyOid: "55", lineaPrestamoDescripcion: "Línea" } });
  try {
    await assert.rejects(() => f.service.replace(f.s.id, f.actor, f.input), /otra solicitud/);
    assert.equal((await administrativeSource(db, f.s.id)).legacyOid, "443417");
    assert.equal((await db.solicitud.findUniqueOrThrow({ where: { id: other.id } })).legacyOid, f.newId);
    assert.equal((await db.solicitudPrestamoReplacement.findUniqueOrThrow({ where: { id: f.input.requestId } })).newLoanId, f.newId);
    await assert.rejects(() => f.service.replace(f.s.id, f.actor, f.input), /otra solicitud/);
    assert.equal(f.calls(), 1);
  } finally { await db.solicitud.delete({ where: { id: other.id } }); await f.clean(); }
});
