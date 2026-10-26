import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { InitialLoanGenerationService } from "./InitialLoanGenerationService";
import { administrativeSource } from "./AdministrativeCorrectionService";
import { SolicitudesCorePrismaDatasource } from "../datasources/SolicitudesCorePrismaDatasource";

const enabled = Boolean(process.env.BEEX_TEST_DATABASE_URL);
const db = new PrismaClient({ datasourceUrl: process.env.BEEX_TEST_DATABASE_URL });
after(() => db.$disconnect());

async function fixture() {
  const url = new URL(process.env.BEEX_TEST_DATABASE_URL!);
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"));
  const state = await db.workflowState.findUniqueOrThrow({ where: { code: "Confirmada" } });
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", workflowOwnerId: state.ownerId } });
  const admin = await db.user.create({ data: { email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", isSystemAdmin: true } });
  const s = await db.solicitud.create({ data: {
    createdBy: user.id, estadoActualId: state.id, lineaPrestamoLegacyOid: "55", lineaPrestamoDescripcion: "Línea",
    montoAFinanciar: 500000, cuotas: 12, titular: { create: { nroDocumento: "12345678" } },
  } });
  const repository = new SolicitudesCorePrismaDatasource(db);
  const prepared = { solicitud: (await repository.findById(s.id))!, codigoMutual: "amejuca", coreInput: {
    cuotas: 12, fechaEmision: "2026-10-26", integrantes: [{ socio: "77", tipoRelacion: "Titular" as const }], lineaPrestamo: "88", montoDeseado: 500000, vendedor: "5",
  } };
  let calls = 0;
  const loanId = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const deps: ConstructorParameters<typeof InitialLoanGenerationService>[0] = {
    db, repository, gateway: { crear: async () => { calls++; return { id: loanId }; } },
    linkedLoanReader: async () => ({ status: "active", currentLoanId: loanId, resolvedLoanId: loanId, amount: 500000, requestedAmount: 500000, matchesAmount: true, amountEditable: false }),
    loanSnapshot: async id => ({ id, estado: 0, amount: 500000, cuotas: 12, lineaId: "88", primerVencimiento: null, cancelacionesCentavos: 0 }),
    makeSignatureLink: id => `https://example.test/sign?loan=${id}`,
  };
  const input = { solicitudId: s.id, currentUser: { id: user.id, isSystemAdmin: false, workflowOwnerId: state.ownerId } };
  const clean = async () => {
    await db.beexNotification.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitudEstadoHistorial.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitud.delete({ where: { id: s.id } });
    await db.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } });
  };
  return { s, deps, input, prepared, admin, loanId, calls: () => calls, clean, service: new InitialLoanGenerationService(deps), repository };
}

it("database reservation blocks concurrent generation and amount editing, and creates one audited link/notification", { skip: !enabled }, async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  try {
    const original = f.deps.gateway.crear;
    f.deps.gateway.crear = async input => { const result = await original(input); started(); await gate; return result; };
    const first = f.service.create(f.prepared, f.input);
    await began;
    await assert.rejects(f.service.create(f.prepared, f.input), /generación.*incierto/);
    await assert.rejects(f.repository.update(f.s.id, { solicitud: { montoAFinanciar: 600000 } }), /generación.*incierto/);
    release();
    await first;
    const result = await administrativeSource(db, f.s.id);
    assert.equal(result.legacyOid, f.loanId);
    assert.equal(result.estadoActual.code, "Confirmada");
    assert.equal(result.montoAFinanciar?.toString(), "500000");
    assert.equal(f.calls(), 1);
    assert.equal(await db.beexNotification.count({ where: { solicitudId: f.s.id, kind: "signature_link_available", recipientId: f.input.currentUser.id } }), 1);
    const history = await db.solicitudEstadoHistorial.findMany({ where: { solicitudId: f.s.id }, orderBy: { changedAt: "asc" } });
    assert.deepEqual(history.map(h => h.actionCode), ["LOAN_GENERATION_STARTED", "LOAN_GENERATED"]);
    assert(history.every(h => h.changedBy === f.input.currentUser.id && h.estadoAnteriorId === h.estadoNuevoId));
    await assert.rejects(f.repository.update(f.s.id, { solicitud: { montoAFinanciar: 600000 } }), /congelado/);
  } finally { release?.(); await f.clean(); }
});

it("an uncertain first generation is recovered without a new Core request and only with a verified matching loan", { skip: !enabled }, async () => {
  const f = await fixture();
  try {
    const original = f.deps.gateway.crear;
    f.deps.gateway.crear = async input => { await original(input); throw new Error("timeout after creation"); };
    await assert.rejects(f.service.create(f.prepared, f.input), /no confirmó/);
    const current = await administrativeSource(db, f.s.id);
    const pending = (current.administrativeCoreControl as { generationPending: { requestId: string; status: string } }).generationPending;
    assert.equal(pending.status, "UNCERTAIN");
    const recovery = { requestId: pending.requestId, expectedUpdatedAt: current.updatedAt.toISOString(), newLoanId: f.loanId, reason: "Préstamo confirmado en Vimarx por el operador" };
    await assert.rejects(f.service.recover(f.s.id, f.input.currentUser, recovery), /administrador/);
    const admin = { id: f.admin.id, isSystemAdmin: true, workflowOwnerId: "" };
    const snapshot = f.deps.loanSnapshot;
    f.deps.loanSnapshot = async (...args) => ({ ...(await snapshot(...args))!, amount: 600000 });
    await assert.rejects(f.service.recover(f.s.id, admin, recovery), /no coincide/);
    f.deps.loanSnapshot = snapshot;
    await f.service.recover(f.s.id, admin, recovery);
    assert.equal((await administrativeSource(db, f.s.id)).legacyOid, f.loanId);
    assert.equal(f.calls(), 1);
    const history = await db.solicitudEstadoHistorial.findFirstOrThrow({ where: { solicitudId: f.s.id, actionCode: "LOAN_GENERATED" } });
    assert.equal(history.changedBy, f.admin.id);
  } finally { await f.clean(); }
});
