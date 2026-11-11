import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import { actingContext } from "../../../auth/impersonation/context";
import { canManageSignature, reviewSource, signatureSummary } from "../../../document-review/signature-workflow";
import { administrativeSource, correctionBlockedReason } from "./AdministrativeCorrectionService";
import { LoanReliquidationService } from "./LoanReliquidationService";
import { InitialLoanGenerationService } from "./InitialLoanGenerationService";
import { SolicitudesCorePrismaDatasource } from "../datasources/SolicitudesCorePrismaDatasource";
import { SolicitudRefinanciacionPrismaRepository } from "../repositories/SolicitudRefinanciacionPrismaRepository";
import { refinanciacionVersion } from "../../domain/repositories/SolicitudRefinanciacionRepository";
import { reliquidation, RELIQUIDATION_ACTION } from "../../domain/workflow/LoanReliquidation";
import type { CoreLoanLifecycle } from "./ControlledLoanReplacementService";

const enabled = Boolean(process.env.BEEX_TEST_DATABASE_URL);
const db = new PrismaClient({ datasourceUrl: process.env.BEEX_TEST_DATABASE_URL });
after(() => db.$disconnect());

async function fixture(code = "VerificarFirmaYDocumentacion") {
  const url = new URL(process.env.BEEX_TEST_DATABASE_URL!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_test"));
  const state = await db.workflowState.findUniqueOrThrow({ where: { code }, include: { owner: true } });
  const risk = await db.workflowOwner.findUniqueOrThrow({ where: { code: "RIESGO" } });
  const users = await Promise.all([state.ownerId, risk.id].map(workflowOwnerId => db.user.create({ data: {
    email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", workflowOwnerId,
  }, include: { workflowOwner: true } })));
  const [actor, analyst] = users as unknown as AuthUser[];
  const previousLoanId = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const s = await db.solicitud.create({ data: {
    createdBy: actor.id, assignedToUserId: analyst.id, estadoActualId: state.id,
    legacyOid: previousLoanId, linkFirmaDigital: `https://example.test/old/${previousLoanId}`,
    signatureCycleId: randomUUID(), analisisFinalizadoAt: new Date(), analisisFinalizadoBy: analyst.id,
    montoAFinanciar: 500000, cuotas: 12, lineaPrestamoLegacyOid: "55", lineaPrestamoDescripcion: "Línea",
    titular: { create: { nroDocumento: "12345678" } },
  } });
  const cancelled: CoreLoanLifecycle = { id: previousLoanId, account: "123", estado: 9, estadoPrestamo: 9,
    estadoLabel: "Anulado", estadoPrestamoLabel: "Anulado", vigente: false, saldo: 0 };
  const deps: ConstructorParameters<typeof LoanReliquidationService>[0] = { db, lifecycle: async () => cancelled, transferState: async () => "unpaid" };
  const service = new LoanReliquidationService(deps);
  const input = { requestId: randomUUID(), expectedUpdatedAt: s.updatedAt.toISOString(), previousLoanId, reason: "Corrección de condiciones solicitada por Riesgo" };
  const prepare = async () => {
    const view = await service.prepare(s.id, actor, input);
    return { ...input, expectedUpdatedAt: view.updatedAt };
  };
  const reserve = (data: Partial<Prisma.TransferenciaDesembolsoUncheckedCreateInput> = {}) => db.transferenciaDesembolso.create({ data: {
    solicitudId: s.id, prestamoLegacyId: previousLoanId, idempotencyKey: randomUUID(), reservationHash: "test", planVersion: "test", plan: {}, clientId: "test", installationId: "test", operator: "test", ...data,
  } });
  const clean = async () => {
    await db.beexNotification.deleteMany({ where: { solicitudId: s.id } });
    await db.transferenciaPago.deleteMany({ where: { desembolso: { solicitudId: s.id } } });
    await db.transferenciaDesembolso.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitudEstadoHistorial.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitud.delete({ where: { id: s.id } });
    await db.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
  };
  return { s, state, actor, analyst, deps, cancelled, service, input, prepare, reserve, clean };
}

it("a prepared cancellation returns to Risk once, clears the old loan/signature and preserves audit/assignment", { skip: !enabled }, async () => {
  for (const state of ["VerificarFirmaYDocumentacion", "Transferir"]) {
    const f = await fixture(state);
    try {
      await assert.rejects(f.service.reopen(f.s.id, f.actor, f.input), /Primero prepará/);
      const input = await f.prepare();
      const paused = await administrativeSource(db, f.s.id);
      assert(!canManageSignature(paused));
      const repository = new SolicitudesCorePrismaDatasource(db);
      await assert.rejects(repository.update(f.s.id, { solicitud: { cuotas: 24 } }, { enforceMontoAprobadoRiesgo: false, expectedEstadoActualId: paused.estadoActualId, expectedLegacyOid: paused.legacyOid }), /pausada/);
      const results = await Promise.all([f.service.reopen(f.s.id, f.actor, input), f.service.reopen(f.s.id, f.actor, input)]);
      assert(results.every(r => r.pending));
      const reopened = await administrativeSource(db, f.s.id);
      assert.equal(reopened.estadoActual.code, "RevisionRiesgo");
      assert.equal(reopened.assignedToUserId, f.analyst.id);
      assert.equal(reopened.legacyOid, null); assert.equal(reopened.linkFirmaDigital, null);
      assert.equal(reopened.analisisFinalizadoAt, null); assert.equal(reopened.analisisFinalizadoBy, null);
      assert.notEqual(reopened.signatureCycleId, f.s.signatureCycleId);
      assert.equal(signatureSummary(reopened, null, null).approved, false);
      const history = await db.solicitudEstadoHistorial.findMany({ where: { solicitudId: f.s.id, actionCode: RELIQUIDATION_ACTION } });
      assert.equal(history.length, 1);
      const metadata = history[0].metadata as Prisma.JsonObject;
      assert.equal(metadata.previousLoanId, f.s.legacyOid);
      assert.equal(metadata.previousSignatureLink, f.s.linkFirmaDigital);
      assert.equal(history[0].changedBy, f.actor.id);
      assert.equal(history[0].realActorUserId, f.actor.id);
      await assert.rejects(f.service.reopen(f.s.id, f.actor, { ...input, reason: "Otro motivo incompatible" }), /otros datos/);
    } finally { await f.clean(); }
  }
});

it("unknown/active cancellation or transport failure keeps the original link and durable pause", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const input = await f.prepare();
    for (const response of [null, { ...f.cancelled, vigente: true }, { ...f.cancelled, saldo: 1 }, { ...f.cancelled, estadoPrestamoLabel: null }]) {
      f.deps.lifecycle = async () => response;
      await assert.rejects(f.service.reopen(f.s.id, f.actor, input), /Vimarx debe confirmar/);
    }
    f.deps.lifecycle = async () => { throw new Error("timeout"); };
    await assert.rejects(f.service.reopen(f.s.id, f.actor, input), /timeout/);
    const current = await administrativeSource(db, f.s.id);
    assert.equal(current.legacyOid, f.s.legacyOid);
    assert.equal(current.estadoActualId, f.s.estadoActualId);
    assert.equal((current.administrativeCoreControl as Prisma.JsonObject).reliquidationHold !== null, true);
    assert.equal(await db.solicitudEstadoHistorial.count({ where: { solicitudId: f.s.id, actionCode: RELIQUIDATION_ACTION } }), 0);
  } finally { await f.clean(); }
});

it("paid or unknown Core transfer state blocks preparation and reopening without releasing the pause", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    for (const state of ["paid", "unknown"] as const) {
      f.deps.transferState = async () => state;
      await assert.rejects(f.prepare(), /Pagada|determinar el estado/);
    }
    f.deps.transferState = async () => "unpaid";
    const input = await f.prepare();
    for (const state of ["paid", "unknown"] as const) {
      f.deps.transferState = async () => state;
      await assert.rejects(f.service.reopen(f.s.id, f.actor, input), /Pagada|determinar el estado/);
    }
    assert.equal((await administrativeSource(db, f.s.id)).legacyOid, f.s.legacyOid);
    assert.equal((await f.service.view(f.s.id, f.actor)).prepared, true);
  } finally { await f.clean(); }
});

it("all reservations, including partial bank payments, are rejected without cancelling anything", { skip: !enabled }, async () => {
  for (const variant of ["reserved", "started", "partial", "completed"]) {
    const f = await fixture("Transferir");
    try {
      const reservation = await f.reserve({ bankStartedAt: variant !== "reserved" ? new Date() : null, completedAt: variant === "completed" ? new Date() : null });
      if (variant === "partial") await db.transferenciaPago.create({ data: { desembolsoId: reservation.id, paymentKey: "one", bankTransactionId: randomUUID(), confirmedAt: new Date(), confirmedPayload: {} } });
      const view = await f.service.view(f.s.id, f.actor);
      assert.equal(view.canReopen, false); assert.match(view.blockedReason!, /reserva/);
      await assert.rejects(f.prepare(), /reserva/);
      assert.equal(await db.transferenciaDesembolso.count({ where: { id: reservation.id } }), 1);
    } finally { await f.clean(); }
  }
});

it("refinancing, prior paid history, stale versions, inactive analyst and wrong/impersonated area are blocked", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.prepare(f.s.id, f.analyst, f.input), /área a cargo/);
    await assert.rejects(actingContext.run({ administrator: f.actor } as never, () => f.service.prepare(f.s.id, f.actor, f.input)), /propia sesión/);
    await assert.rejects(f.service.prepare(f.s.id, f.actor, { ...f.input, expectedUpdatedAt: new Date(0).toISOString() }), /cambió/);
    await db.user.update({ where: { id: f.analyst.id }, data: { state: 0 } });
    await assert.rejects(f.prepare(), /analista activo/);
    await db.user.update({ where: { id: f.analyst.id }, data: { state: 1 } });
    await db.solicitudRefinanciacion.create({ data: { solicitudId: f.s.id, prestamoLegacyId: "999", nrosCuota: [1] } });
    await assert.rejects(f.prepare(), /refinanciación/);
    await db.solicitudRefinanciacion.deleteMany({ where: { solicitudId: f.s.id } });
    await db.solicitudEstadoHistorial.create({ data: { solicitudId: f.s.id, estadoNuevoId: f.state.id, toStateCodeSnapshot: "Pagada", toStateNameSnapshot: "Pagada" } });
    await assert.rejects(f.prepare(), /antecedentes de pago/);
  } finally { await f.clean(); }
});

it("a financial change during the Core read prevents reopening under the shared row lock", { skip: !enabled }, async () => {
  const f = await fixture("Transferir");
  try {
    const input = await f.prepare();
    f.deps.lifecycle = async () => { await f.reserve(); return f.cancelled; };
    await assert.rejects(f.service.reopen(f.s.id, f.actor, input), /reserva/);
    assert.equal((await administrativeSource(db, f.s.id)).legacyOid, f.s.legacyOid);
  } finally { await f.clean(); }
});

it("reliquidation uses ordinary generation with a new verified loan, rejects refinancing and rechecks the previous cancellation", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    await f.service.reopen(f.s.id, f.actor, await f.prepare());
    const refi = new SolicitudRefinanciacionPrismaRepository(db);
    const current = await administrativeSource(db, f.s.id);
    await assert.rejects(refi.replace({ solicitudId: f.s.id, prestamos: [{ prestamoId: "999", nrosCuota: [1] }], expectedVersion: refinanciacionVersion(await refi.findBySolicitudId(f.s.id)), expectedSolicitudUpdatedAt: current.updatedAt, updatedBy: f.analyst.id }), /no admite agregar/);
    const confirmed = await db.workflowState.findUniqueOrThrow({ where: { code: "Confirmada" } });
    await db.solicitud.update({ where: { id: f.s.id }, data: { estadoActualId: confirmed.id, cuotas: 24 } });
    // Old downstream stages do not prevent the new analysis from returning to the seller.
    await db.solicitudEstadoHistorial.create({ data: { solicitudId: f.s.id, estadoNuevoId: f.state.id, toStateCodeSnapshot: f.state.code, toStateNameSnapshot: f.state.name, changedAt: f.s.createdAt } });
    assert.equal(await correctionBlockedReason(db, await administrativeSource(db, f.s.id)), null);
    const repository = new SolicitudesCorePrismaDatasource(db);
    const prepared = { solicitud: (await repository.findById(f.s.id))!, codigoMutual: "amejuca", coreInput: {
      cuotas: 24, fechaEmision: "2026-11-11", integrantes: [{ socio: "77", tipoRelacion: "Titular" as const }], lineaPrestamo: "88", montoDeseado: 500000, vendedor: "5",
    } };
    let calls = 0;
    const newId = `${f.s.legacyOid}1`;
    const deps: ConstructorParameters<typeof InitialLoanGenerationService>[0] = {
      db, repository, lifecycle: (...args) => f.deps.lifecycle(...args), transferState: (...args) => f.deps.transferState(...args),
      gateway: { crear: async () => { calls++; return { id: newId }; } },
      loanSnapshot: async id => ({ id, estado: 0, amount: 500000, cuotas: 24, lineaId: "88", primerVencimiento: null, cancelacionesCentavos: 0 }),
      makeSignatureLink: id => `https://example.test/new/${id}`,
      linkedLoanReader: async () => ({ status: "active", currentLoanId: newId, resolvedLoanId: newId, amount: 500000, requestedAmount: 500000, matchesAmount: true, amountEditable: false }),
    };
    const service = new InitialLoanGenerationService(deps);
    const input = { solicitudId: f.s.id, currentUser: { id: f.analyst.id, isSystemAdmin: false, workflowOwnerId: f.analyst.workflowOwnerId! } };
    f.deps.lifecycle = async () => ({ ...f.cancelled, vigente: true });
    await assert.rejects(service.create(prepared, input), /Vimarx debe confirmar/);
    assert.equal(calls, 0);
    f.deps.lifecycle = async () => f.cancelled;
    const beforeSource = reviewSource(await administrativeSource(db, f.s.id));
    await service.create(prepared, input);
    const linked = await administrativeSource(db, f.s.id);
    assert.equal(linked.legacyOid, newId); assert.equal(linked.linkFirmaDigital, `https://example.test/new/${newId}`);
    assert.equal(reliquidation(linked.administrativeCoreControl)?.status, "LINKED");
    assert.notDeepEqual(reviewSource(linked), beforeSource);
    assert.equal(signatureSummary(linked, null, null).approved, false);
    await service.create(prepared, input);
    assert.equal(calls, 1);
    assert.equal(await db.solicitudEstadoHistorial.count({ where: { solicitudId: f.s.id, actionCode: "LOAN_GENERATED" } }), 1);
  } finally { await f.clean(); }
});

it("a reused old loan ID, mismatching new loan or uncertain generation stays reserved and cannot generate twice", { skip: !enabled }, async () => {
  for (const variant of ["old-id", "mismatch", "timeout"]) {
    const f = await fixture();
    try {
      await f.service.reopen(f.s.id, f.actor, await f.prepare());
      const confirmed = await db.workflowState.findUniqueOrThrow({ where: { code: "Confirmada" } });
      await db.solicitud.update({ where: { id: f.s.id }, data: { estadoActualId: confirmed.id } });
      const repository = new SolicitudesCorePrismaDatasource(db);
      const prepared = { solicitud: (await repository.findById(f.s.id))!, codigoMutual: "amejuca", coreInput: {
        cuotas: 12, fechaEmision: "2026-11-11", integrantes: [{ socio: "77", tipoRelacion: "Titular" as const }], lineaPrestamo: "88", montoDeseado: 500000, vendedor: "5",
      } };
      let calls = 0;
      const service = new InitialLoanGenerationService({
        db, repository, lifecycle: (...args) => f.deps.lifecycle(...args), transferState: (...args) => f.deps.transferState(...args),
        gateway: { crear: async () => { calls++; if (variant === "timeout") throw new Error("timeout"); return { id: variant === "old-id" ? f.s.legacyOid! : `${f.s.legacyOid}1` }; } },
        loanSnapshot: async id => ({ id, estado: 0, amount: variant === "mismatch" ? 600000 : 500000, cuotas: 12, lineaId: "88", primerVencimiento: null, cancelacionesCentavos: 0 }),
        makeSignatureLink: id => `https://example.test/new/${id}`,
        linkedLoanReader: async () => { throw new Error("must not link"); },
      });
      const input = { solicitudId: f.s.id, currentUser: { id: f.analyst.id, isSystemAdmin: false, workflowOwnerId: f.analyst.workflowOwnerId! } };
      await assert.rejects(service.create(prepared, input), /no coincide|no confirmó/);
      const current = await administrativeSource(db, f.s.id);
      assert.equal(current.legacyOid, null); assert.equal(current.linkFirmaDigital, null);
      assert((current.administrativeCoreControl as Prisma.JsonObject).generationPending);
      await assert.rejects(service.create(prepared, input), /generación.*incierto/);
      assert.equal(calls, 1);
    } finally { await f.clean(); }
  }
});
