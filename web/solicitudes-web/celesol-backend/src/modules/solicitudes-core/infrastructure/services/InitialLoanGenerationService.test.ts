import assert from "node:assert/strict";
import { it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import { InitialLoanGenerationService, type PreparedInitialLoan } from "./InitialLoanGenerationService";
import { coreReconciliationPending } from "../../domain/workflow/AdministrativeCorrection";

function fixture() {
  let row = {
    id: "sol-1", legacyOid: null as string | null, estadoActualId: "confirmed", updatedAt: new Date("2026-10-26T00:00:00Z"),
    archivedAt: null, montoAFinanciar: 500000, cuotas: 12, lineaPrestamoLegacyOid: "55",
    lineaPrestamoDescripcion: "Línea", lineaPrestamoCodigoMutual: null as string | null, linkFirmaDigital: null as string | null,
    administrativeCoreControl: {} as Record<string, unknown>, titular: { nroDocumento: "12345678" },
    estadoActual: { id: "confirmed", code: "Confirmada", name: "Confirmada", ownerId: "risk", owner: { id: "risk", code: "RIESGO", name: "Riesgo" } },
    cancelaciones: [], desembolso: null, pagoExterno: null, createdBy: "operator", vendedorId: "seller", nroSolicitud: "900",
  };
  const audits: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];
  let calls = 0;
  const prepared: PreparedInitialLoan = {
    solicitud: structuredClone(row) as unknown as SolicitudCore, codigoMutual: "amejuca",
    coreInput: { cuotas: 12, fechaEmision: "2026-10-26", integrantes: [{ socio: "77", tipoRelacion: "Titular" }], lineaPrestamo: "88", montoDeseado: 500000, vendedor: "5" },
  };
  const actor = { id: "operator", workflowOwnerId: "risk", isSystemAdmin: false };
  const db = {
    $queryRaw: async () => [],
    solicitud: {
      findUnique: async () => structuredClone(row),
      findFirst: async () => null,
      update: async (input: { data: Partial<typeof row> }) => { row = { ...row, ...input.data, updatedAt: new Date(row.updatedAt.getTime() + 1) }; return structuredClone(row); },
    },
    user: { findFirst: async (input: { where: { id: string } }) => ({ ...actor, id: input.where.id, isSystemAdmin: input.where.id === "admin", state: 1, deletedAt: null }) },
    solicitudEstadoHistorial: { create: async (input: { data: Record<string, unknown> }) => { audits.push(input.data); return input.data; } },
    beexNotification: { createMany: async (input: { data: Array<Record<string, unknown>> }) => { notifications.push(...input.data); return { count: input.data.length }; } },
  };
  let tail: Promise<unknown> = Promise.resolve();
  const prisma = { ...db, $transaction: <T>(fn: (tx: typeof db) => Promise<T>) => {
    const run = tail.then(async () => {
      const snapshot = structuredClone(row), beforeAudits = audits.length, beforeNotifications = notifications.length;
      try { return await fn(db); } catch (e) { row = snapshot; audits.length = beforeAudits; notifications.length = beforeNotifications; throw e; }
    });
    tail = run.catch(() => undefined);
    return run;
  } } as unknown as PrismaClient;
  const deps: ConstructorParameters<typeof InitialLoanGenerationService>[0] = {
    db: prisma, repository: { findById: async () => structuredClone(row) as unknown as SolicitudCore },
    gateway: { crear: async () => { calls++; return { id: "444" }; } },
    linkedLoanReader: async () => ({ status: "active", currentLoanId: "444", resolvedLoanId: "444", amount: 500000, requestedAmount: 500000, matchesAmount: true, amountEditable: false }),
    loanSnapshot: async id => ({ id, estado: 0, amount: 500000, cuotas: 12, lineaId: "88", primerVencimiento: null, cancelacionesCentavos: 0 }),
    makeSignatureLink: id => `https://example.test/sign?loan=${id}`,
  };
  return { deps, service: new InitialLoanGenerationService(deps), prepared, actor, audits, notifications, row: () => row, calls: () => calls, mutate: (change: Partial<typeof row>) => { row = { ...row, ...change }; } };
}

it("reserves durably before calling Core, links without changing state, audits actor and notifies once", async () => {
  const f = fixture();
  const original = f.deps.gateway.crear;
  f.deps.gateway.crear = async input => {
    assert.equal((f.row().administrativeCoreControl.generationPending as { status: string }).status, "CREATING");
    assert.equal(f.row().legacyOid, null);
    return original(input);
  };
  await f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor });
  assert.equal(f.row().legacyOid, "444");
  assert.equal(f.row().estadoActual.code, "Confirmada");
  assert.equal(f.row().administrativeCoreControl.generationPending, null);
  assert.equal(coreReconciliationPending(f.row()), false);
  assert.deepEqual(f.audits.map(a => a.actionCode), ["LOAN_GENERATION_STARTED", "LOAN_GENERATED"]);
  assert(f.audits.every(a => a.changedBy === "operator"));
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0]!.recipientId, "seller");
  await f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor });
  assert.equal(f.calls(), 1);
  assert.equal(f.notifications.length, 1);
});

it("two concurrent operators cannot send two creation requests", async () => {
  const f = fixture();
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const original = f.deps.gateway.crear;
  f.deps.gateway.crear = async input => { const result = await original(input); await paused; return result; };
  const first = f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor });
  while (!f.calls()) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /generación.*incierto/);
  release();
  await first;
  assert.equal(f.calls(), 1);
});

it("an uncertain response blocks creation and is recoverable only as administrator with matching Core evidence", async () => {
  const f = fixture();
  const original = f.deps.gateway.crear;
  f.deps.gateway.crear = async input => { await original(input); throw new Error("timeout"); };
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /no confirmó/);
  const pending = f.row().administrativeCoreControl.generationPending as { requestId: string; status: string };
  assert.equal(pending.status, "UNCERTAIN");
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /generación.*incierto/);
  const input = { requestId: pending.requestId, expectedUpdatedAt: f.row().updatedAt.toISOString(), newLoanId: "444", reason: "Préstamo verificado en Vimarx" };
  await assert.rejects(f.service.recover("sol-1", f.actor, input), /administrador/);
  const snapshot = f.deps.loanSnapshot;
  f.deps.loanSnapshot = async (...args) => ({ ...(await snapshot(...args))!, amount: 600000 });
  await assert.rejects(f.service.recover("sol-1", { ...f.actor, id: "admin", isSystemAdmin: true }, input), /no coincide/);
  f.deps.loanSnapshot = snapshot;
  await f.service.recover("sol-1", { ...f.actor, id: "admin", isSystemAdmin: true }, input);
  assert.equal(f.row().legacyOid, "444");
  assert.equal(f.calls(), 1);
  assert.equal(f.audits.at(-1)!.changedBy, "admin");
});

it("a local link failure preserves the returned Core ID and blocks another generation", async () => {
  const f = fixture();
  f.deps.makeSignatureLink = () => { throw new Error("link failure"); };
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /link failure/);
  const pending = f.row().administrativeCoreControl.generationPending as { status: string; newLoanId: string };
  assert.equal(pending.status, "CREATED");
  assert.equal(pending.newLoanId, "444");
  assert.equal(f.row().legacyOid, null);
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /generación.*incierto/);
  assert.equal(f.calls(), 1);
});
