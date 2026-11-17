import assert from "node:assert/strict";
import { it } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CrearPrestamoGateway, PrestamoLegacyNotSentError } from "./CrearPrestamoGateway";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import { InitialLoanGenerationService, type PreparedInitialLoan } from "./InitialLoanGenerationService";
import { coreReconciliationPending, coreConditionsFingerprint } from "../../domain/workflow/AdministrativeCorrection";
import { LoanGenerationCheckService, type GenerationLoan } from "./LoanGenerationCheckService";
import { actingContext } from "../../../auth/impersonation/context";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import type { LoanDiagnosticContext, LoanDiagnosticWriter } from "../../../technical-diagnostics/LoanDiagnostics";
import { createLoanDiagnosticWriter } from "../../../technical-diagnostics/LoanDiagnostics";

function fixture() {
  let row = {
    id: "sol-1", legacyOid: null as string | null, estadoActualId: "confirmed", updatedAt: new Date("2026-10-26T00:00:00Z"),
    archivedAt: null, montoAFinanciar: 500000, cuotas: 12, lineaPrestamoLegacyOid: "55",
    fechaPrimerVencimiento: null as string | null,
    lineaPrestamoDescripcion: "Línea", lineaPrestamoCodigoMutual: null as string | null, linkFirmaDigital: null as string | null,
    administrativeCoreControl: {} as Record<string, unknown>, titular: { nroDocumento: "12345678" },
    estadoActual: { id: "confirmed", code: "Confirmada", name: "Confirmada", ownerId: "risk", owner: { id: "risk", code: "RIESGO", name: "Riesgo" } },
    cancelaciones: [], desembolso: null, pagoExterno: null, createdBy: "operator", vendedorId: "seller", nroSolicitud: "900",
  };
  const audits: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];
  let calls = 0;
  let persistenceError: Error | null = null;
  let cleanupError: Error | null = null;
  let commitError: Error | null = null;
  const updates: Array<Partial<typeof row>> = [];
  const evidence: { stage: string; data: Prisma.JsonValue }[] = [];
  const gatewayContexts: (LoanDiagnosticContext | undefined)[] = [];
  const diagnostics: { context: LoanDiagnosticContext; event: Parameters<LoanDiagnosticWriter>[1] }[] = [];
  const prepared: PreparedInitialLoan = {
    solicitud: structuredClone(row) as unknown as SolicitudCore, codigoMutual: "amejuca",
    coreInput: { cuotas: 12, fechaEmision: "2026-10-26", integrantes: [{ socio: "77", tipoRelacion: "Titular" }], lineaPrestamo: "88", montoDeseado: 500000, vendedor: "5" },
  };
  const actor = { id: "operator", workflowOwnerId: "risk", isSystemAdmin: false };
  const db = {
    $queryRaw: async () => [],
    technicalDiagnosticEvent: { findMany: async () => evidence },
    solicitud: {
      findUnique: async () => structuredClone(row),
      findFirst: async () => null,
      update: async (input: { data: Partial<typeof row> }) => {
        if (persistenceError && (input.data.administrativeCoreControl?.generationPending as { status?: string } | undefined)?.status === "CREATED") throw persistenceError;
        if (cleanupError && Object.is(input.data.administrativeCoreControl, Prisma.DbNull)) throw cleanupError;
        updates.push(input.data);
        row = { ...row, ...input.data, ...(Object.is(input.data.administrativeCoreControl, Prisma.DbNull) ? { administrativeCoreControl: {} } : {}), updatedAt: new Date(row.updatedAt.getTime() + 1) }; return structuredClone(row);
      },
    },
    user: { findFirst: async (input: { where: { id: string } }) => ({ ...actor, id: input.where.id, isSystemAdmin: input.where.id === "admin", state: 1, deletedAt: null }) },
    solicitudEstadoHistorial: { create: async (input: { data: Record<string, unknown> }) => { audits.push(input.data); return input.data; } },
    beexNotification: { createMany: async (input: { data: Array<Record<string, unknown>> }) => { notifications.push(...input.data); return { count: input.data.length }; } },
  };
  let tail: Promise<unknown> = Promise.resolve();
  const prisma = { ...db, $transaction: <T>(fn: (tx: typeof db) => Promise<T>) => {
    const run = tail.then(async () => {
      const snapshot = structuredClone(row), beforeAudits = audits.length, beforeNotifications = notifications.length;
      let result: T;
      try { result = await fn(db); } catch (e) { row = snapshot; audits.length = beforeAudits; notifications.length = beforeNotifications; throw e; }
      // Simulate a durable COMMIT whose acknowledgement is lost at the client.
      if (commitError) { const error = commitError; commitError = null; throw error; }
      return result;
    });
    tail = run.catch(() => undefined);
    return run;
  } } as unknown as PrismaClient;
  const deps: ConstructorParameters<typeof InitialLoanGenerationService>[0] = {
    db: prisma, repository: { findById: async () => structuredClone(row) as unknown as SolicitudCore },
    gateway: { crear: async (_input, context) => { calls++; gatewayContexts.push(context); return { id: "444" }; } },
    linkedLoanReader: async () => ({ status: "active", currentLoanId: "444", resolvedLoanId: "444", amount: 500000, requestedAmount: 500000, matchesAmount: true, amountEditable: false }),
    loanSnapshot: async id => ({ id, estado: 0, amount: 500000, cuotas: 12, lineaId: "88", primerVencimiento: null, cancelacionesCentavos: 0 }),
    makeSignatureLink: id => `https://example.test/sign?loan=${id}`,
    diagnostics: async (context, event) => { diagnostics.push({ context, event }); },
  };
  return { deps, service: new InitialLoanGenerationService(deps), prepared, actor, audits, notifications, diagnostics, gatewayContexts,
    row: () => row, calls: () => calls, updates, evidence, failCleanup: (error: Error) => { cleanupError = error; }, failNextCommit: (error: Error) => { commitError = error; }, failPersistence: (error: Error) => { persistenceError = error; },
    mutate: (change: Partial<typeof row>) => { row = { ...row, ...change }; } };
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

it("rejects a prepared request that omits or changes the saved due date before contacting Core", async () => {
  const f = fixture();
  f.mutate({ fechaPrimerVencimiento: "2026-12-31" });
  f.prepared.solicitud.fechaPrimerVencimiento = "2026-12-31";
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /condiciones cambiaron/);
  assert.equal(f.calls(), 0);
});

it("keeps a generated loan reserved when its date differs or is missing, and recovers only the verified date without generating again", async () => {
  for (const actual of ["2026-11-30", null]) {
    const f = fixture();
    f.mutate({ fechaPrimerVencimiento: "2026-12-31" });
    f.prepared.solicitud.fechaPrimerVencimiento = "2026-12-31";
    f.prepared.coreInput.fechaPrimerVencimiento = "2026-12-31";
    const snapshot = f.deps.loanSnapshot;
    f.deps.loanSnapshot = async (...args) => ({ ...(await snapshot(...args))!, primerVencimiento: actual });
    await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /vencimiento.*no coincide/);
    assert.equal(f.row().legacyOid, null);
    assert.equal(f.notifications.length, 0);
    const pending = f.row().administrativeCoreControl.generationPending as { status: string; newLoanId: string; requestId: string };
    assert.equal(pending.status, "CREATED");
    assert.equal(pending.newLoanId, "444");
    await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /generación.*incierto/);
    const recovery = { requestId: pending.requestId, expectedUpdatedAt: f.row().updatedAt.toISOString(), newLoanId: "444", reason: "Vencimiento verificado en Vimarx" };
    const admin = { ...f.actor, id: "admin", isSystemAdmin: true };
    await assert.rejects(f.service.recover("sol-1", admin, recovery), /vencimiento.*no coincide/);
    f.deps.loanSnapshot = async (...args) => ({ ...(await snapshot(...args))!, primerVencimiento: "2026-12-31T00:00:00-03:00" });
    await f.service.recover("sol-1", admin, recovery);
    assert.equal(f.row().legacyOid, "444");
    assert.equal(f.notifications.length, 1);
    assert.equal(f.calls(), 1);
  }
});

it("links normally when Vimarx confirms the saved due date", async () => {
  const f = fixture();
  f.mutate({ fechaPrimerVencimiento: "2026-12-31" });
  f.prepared.solicitud.fechaPrimerVencimiento = "2026-12-31";
  f.prepared.coreInput.fechaPrimerVencimiento = "2026-12-31";
  const snapshot = f.deps.loanSnapshot;
  f.deps.loanSnapshot = async (...args) => ({ ...(await snapshot(...args))!, primerVencimiento: "2026-12-31T00:00:00" });
  await f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor });
  assert.equal(f.row().legacyOid, "444");
  assert.equal(f.calls(), 1);
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

it("correlates the durable request, gateway and linking diagnostics with the effective and real actor", async () => {
  const f = fixture();
  await actingContext.run({
    sessionId: "session", auditId: "audit", administrator: { id: "real-admin" } as AuthUser,
    selectedUser: f.actor as AuthUser,
  }, () => f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }));
  const requestId = (f.audits[0].metadata as { requestId: string }).requestId;
  assert.deepEqual(f.gatewayContexts, [{
    operationId: requestId, solicitudId: "sol-1", actorId: "operator", realActorId: "real-admin", operation: "loan_generation",
  }]);
  assert.deepEqual(f.diagnostics.map(entry => entry.event.stage), ["CREATED_REMOTE", "LINKED"]);
  assert(f.diagnostics.every(entry => entry.context.operationId === requestId && entry.context.realActorId === "real-admin"));
  assert.equal((f.diagnostics[0].event.data as { newLoanId: string }).newLoanId, "444");
});

it("records the original technical cause before the safe uncertain error and never retries creation", async () => {
  const f = fixture();
  const cause = new Error("socket reset"), remoteError = new Error("remote timeout", { cause });
  const create = f.deps.gateway.crear;
  f.deps.gateway.crear = async (...args) => { await create(...args); throw remoteError; };
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), error => {
    assert(error instanceof Error);
    assert.match(error.message, /no confirmó/);
    assert.doesNotMatch(error.message, /socket reset|remote timeout/);
    return true;
  });
  const record = f.diagnostics.find(entry => entry.event.stage === "ERROR")!;
  assert.equal((record.event.data as { error: Error }).error, remoteError);
  assert.equal((record.event.data as { error: Error }).error.cause, cause);
  assert.equal((f.row().administrativeCoreControl.generationPending as { status: string }).status, "UNCERTAIN");
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /generación.*incierto/);
  assert.equal(f.calls(), 1);
});

it("records a known remote ID and persistence failure without releasing the reservation", async () => {
  const f = fixture(), failure = new Error("database unavailable after Core creation");
  f.failPersistence(failure);
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), error => error === failure);
  assert.deepEqual(f.diagnostics.map(entry => entry.event.stage), ["CREATED_REMOTE", "PERSISTENCE_FAILED"]);
  assert.equal((f.diagnostics[1].event.data as { error: Error; newLoanId: string }).error, failure);
  assert.equal((f.diagnostics[1].event.data as { newLoanId: string }).newLoanId, "444");
  assert.equal(f.row().legacyOid, null);
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /generación.*incierto/);
  assert.equal(f.calls(), 1);
});

it("keeps link errors and administrative recovery under the original operation without another remote call", async () => {
  const f = fixture(), failure = new Error("signature link storage failed", { cause: new Error("nested storage cause") });
  const makeLink = f.deps.makeSignatureLink;
  f.deps.makeSignatureLink = () => { throw failure; };
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), error => error === failure);
  const pending = f.row().administrativeCoreControl.generationPending as { requestId: string; newLoanId: string };
  const failed = f.diagnostics.find(entry => entry.event.stage === "LINK_FAILED")!;
  assert.equal((failed.event.data as { error: Error }).error, failure);
  f.deps.makeSignatureLink = makeLink;
  await f.service.recover("sol-1", { ...f.actor, id: "admin", isSystemAdmin: true }, {
    requestId: pending.requestId, newLoanId: pending.newLoanId,
    expectedUpdatedAt: f.row().updatedAt.toISOString(), reason: "Verified in Core",
  });
  const linked = f.diagnostics.find(entry => entry.event.stage === "LINKED")!;
  assert.equal(linked.context.operationId, failed.context.operationId);
  assert.equal(linked.context.operation, "loan_recovery");
  assert.equal(linked.context.actorId, "admin");
  assert.equal(f.row().legacyOid, "444");
  assert.equal(f.calls(), 1);
});

it("a rejected diagnostic writer cannot turn a successful generation into failure or unlock an uncertain one", async () => {
  const success = fixture();
  success.deps.diagnostics = async () => { throw new Error("diagnostics unavailable"); };
  await success.service.create(success.prepared, { solicitudId: "sol-1", currentUser: success.actor });
  assert.equal(success.row().legacyOid, "444");
  const uncertain = fixture();
  uncertain.deps.diagnostics = success.deps.diagnostics;
  const create = uncertain.deps.gateway.crear;
  uncertain.deps.gateway.crear = async (...args) => { await create(...args); throw new Error("remote timeout"); };
  await assert.rejects(uncertain.service.create(uncertain.prepared, { solicitudId: "sol-1", currentUser: uncertain.actor }), /no confirmó/);
  assert.equal((uncertain.row().administrativeCoreControl.generationPending as { status: string }).status, "UNCERTAIN");
  assert.equal(uncertain.calls(), 1);
});

it("releases a failed pre-send request trace and permits a deliberate retry with exactly one Core creation", async () => {
  const f = fixture();
  let failTrace = true, remoteCalls = 0;
  let finishLateWrite!: () => void;
  const lateWrite = new Promise<void>(resolve => { finishLateWrite = resolve; });
  const diagnosticDb = { technicalDiagnosticEvent: { create: async () => {
    if (failTrace) await lateWrite;
  } } } as unknown as Pick<PrismaClient, "technicalDiagnosticEvent">;
  f.deps.gateway = new CrearPrestamoGateway({
    baseUrl: "https://core.example.test", timeoutMs: 1000,
    diagnostics: createLoanDiagnosticWriter(diagnosticDb, { timeoutMs: 10, fallback: () => undefined }),
  }, async () => { remoteCalls++; return new Response('{"Ok":true,"ID":"444"}'); });
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /no se envió/);
  assert.equal(remoteCalls, 0);
  assert.equal(f.row().legacyOid, null);
  assert.equal(f.row().administrativeCoreControl.generationPending, undefined);
  assert.equal(f.updates.at(-1)!.administrativeCoreControl, Prisma.DbNull);
  assert.equal(coreReconciliationPending(f.row()), false);
  assert.equal(f.audits.at(-1)!.actionCode, "LOAN_GENERATION_NOT_SENT");
  assert(f.diagnostics.some(entry => entry.event.stage === "RESERVATION_RELEASED"));
  finishLateWrite();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(remoteCalls, 0);
  failTrace = false;
  f.prepared.solicitud.updatedAt = f.row().updatedAt;
  await f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor });
  assert.equal(remoteCalls, 1);
  assert.equal(f.row().legacyOid, "444");
});

it("releases only its own un-sent durable reservation if the reservation COMMIT acknowledgement fails", async () => {
  const f = fixture(), error = new Error("transaction expired waiting for COMMIT");
  f.mutate({ administrativeCoreControl: { retainedControl: "keep" } });
  f.failNextCommit(error);
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /no se envió/);
  assert.equal(f.calls(), 0);
  assert.deepEqual(f.row().administrativeCoreControl, { retainedControl: "keep" });
  assert.equal(f.audits.at(-1)!.actionCode, "LOAN_GENERATION_NOT_SENT");
  const start = f.audits[0]!.metadata as { requestId: string };
  assert(f.diagnostics.every(entry => entry.context.operationId === start.requestId));
  assert.equal((f.diagnostics[0]!.event.data as { phase: string }).phase, "RESERVATION");
});

it("does not clear another operation, a known remote ID or an unresolved refinancing charge", async () => {
  for (const patch of [{ requestId: "another-operation" }, { newLoanId: "444" }, { refinanciacionCobro: { operationId: "charge" } }]) {
    const f = fixture();
    f.deps.gateway.crear = async () => {
      const pending = f.row().administrativeCoreControl.generationPending as Record<string, unknown>;
      f.mutate({ administrativeCoreControl: { generationPending: { ...pending, ...patch } } });
      throw new PrestamoLegacyNotSentError();
    };
    await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /no confirmó/);
    const pending = f.row().administrativeCoreControl.generationPending as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) assert.deepEqual(pending[key], value);
    assert.equal(f.audits.some(a => a.actionCode === "LOAN_GENERATION_NOT_SENT"), false);
  }
});

it("preserves the reservation if its safe cleanup cannot be persisted", async () => {
  const f = fixture();
  f.failCleanup(new Error("cleanup storage failed"));
  f.deps.gateway.crear = async () => { throw new PrestamoLegacyNotSentError(); };
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /no pudo liberarse la reserva/);
  assert(f.row().administrativeCoreControl.generationPending);
  assert.equal(f.calls(), 0);
  assert(f.diagnostics.some(entry => entry.event.stage === "PERSISTENCE_FAILED"));
  await assert.rejects(f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor }), /generación.*incierto/);
});

function checkingFixture() {
  const f = fixture();
  const loan: GenerationLoan = { id: "444", account: "90001", createdAt: "2026-10-26T09:01:00",
    estado: 0, amount: 500000, cuotas: 12, lineaId: "88", primerVencimiento: "2026-12-31", cancelacionesCentavos: 0 };
  const reservation = { requestId: "request-1", actorId: f.actor.id, createdAt: "2026-10-26T12:00:00Z", status: "CREATING",
    sourceFingerprint: coreConditionsFingerprint(f.row()), coreInput: f.prepared.coreInput,
    dispatchState: "NOT_STARTED", beforeCreationPending: false };
  f.mutate({ administrativeCoreControl: { generationPending: reservation } });
  const lookup: { socioId: string; since: Date; knownId?: string }[] = [];
  const recoveries: unknown[] = [];
  const deps: ConstructorParameters<typeof LoanGenerationCheckService>[0] = { db: f.deps.db,
    now: () => new Date("2026-10-26T12:05:00Z"),
    findLoans: async (socioId, since, knownId) => { lookup.push({ socioId, since, knownId }); return [loan]; },
    generation: { recover: async (...args) => { recoveries.push(args); return f.row() as unknown as SolicitudCore; } },
  };
  const admin = { id: "admin", isSystemAdmin: true, workflowOwnerId: "risk" };
  const input = { requestId: "request-1", expectedUpdatedAt: f.row().updatedAt.toISOString() };
  return { ...f, loan, reservation, lookup, recoveries, checking: new LoanGenerationCheckService(deps), checkDeps: deps, admin, checkInput: input };
}

it("checks the reserved Core member and creation instant, proposes one compatible loan, and keeps mutations administrative", async () => {
  const f = checkingFixture();
  const checked = await f.checking.check("sol-1", f.admin, f.checkInput);
  assert.equal(checked.canRecover, true);
  assert.equal(checked.candidate?.id, "444");
  assert.equal(checked.canRelease, false);
  assert.deepEqual(f.lookup, [{ socioId: "77", since: new Date(f.reservation.createdAt), knownId: undefined }]);
  assert.equal((await f.checking.check("sol-1", f.actor, f.checkInput)).canRecover, false);
  await assert.rejects(f.checking.recover("sol-1", f.actor, { ...f.checkInput, newLoanId: "444", reason: "Comprobado en Core" }), /administrador/);
  await f.checking.recover("sol-1", f.admin, { ...f.checkInput, newLoanId: "444", reason: "Comprobado en Core" });
  assert.equal(f.recoveries.length, 1);
  assert.equal(f.calls(), 0);
});

it("never releases an empty search without positive non-delivery evidence, including old reservations and known IDs", async () => {
  for (const patch of [ { dispatchState: undefined, beforeCreationPending: undefined }, { dispatchState: "STARTED" },
    { status: "UNCERTAIN", dispatchState: "STARTED" }, { newLoanId: "444" }, { beforeCreationPending: true } ]) {
    const f = checkingFixture();
    f.mutate({ administrativeCoreControl: { generationPending: { ...f.reservation, ...patch } } });
    f.checkDeps.findLoans = async () => [];
    assert.equal((await f.checking.check("sol-1", f.admin, f.checkInput)).canRelease, false);
    await assert.rejects(f.checking.release("sol-1", f.admin, { ...f.checkInput, reason: "Consulta vacía" }));
    assert(f.row().administrativeCoreControl.generationPending);
  }
});

it("revalidates and audits a safe empty search, preserves other controls and uses SQL NULL when empty", async () => {
  for (const retained of [false, true]) {
    const f = checkingFixture();
    f.mutate({ administrativeCoreControl: { ...f.row().administrativeCoreControl, ...(retained ? { retained: "keep" } : {}) } });
    f.checkDeps.findLoans = async () => [];
    assert.equal((await f.checking.check("sol-1", f.admin, f.checkInput)).canRelease, true);
    await f.checking.release("sol-1", f.admin, { ...f.checkInput, reason: "Consulta de socio sin préstamos y generación no enviada" });
    assert.equal(f.row().administrativeCoreControl.generationPending, undefined);
    assert.equal(f.audits.at(-1)!.actionCode, "LOAN_GENERATION_RESERVATION_RELEASED");
    assert.equal(f.audits.at(-1)!.changedBy, "admin");
    assert.equal(f.row().estadoActual.code, "Confirmada");
    if (retained) assert.deepEqual(f.row().administrativeCoreControl, { retained: "keep" });
    else assert.equal(f.updates.at(-1)!.administrativeCoreControl, Prisma.DbNull);
    assert.equal(f.calls(), 0);
  }
});

it("an unavailable or ambiguous Core search and incompatible financial conditions never unlock or recover", async () => {
  const variants = [{ amount: 1 }, { cuotas: 1 }, { lineaId: "99" }, { estado: 1 }, { cancelacionesCentavos: 1 }, { primerVencimiento: "2027-01-01" }];
  for (const change of variants) {
    const f = checkingFixture();
    f.prepared.coreInput.fechaPrimerVencimiento = "2026-12-31";
    f.checkDeps.findLoans = async () => [{ ...f.loan, ...change }];
    const result = await f.checking.check("sol-1", f.admin, f.checkInput);
    assert.equal(result.canRecover, false); assert.equal(result.canRelease, false);
  }
  const f = checkingFixture();
  f.checkDeps.findLoans = async () => [f.loan, { ...f.loan, id: "445" }];
  assert.equal((await f.checking.check("sol-1", f.admin, f.checkInput)).status, "ambiguous");
  f.checkDeps.findLoans = async () => { throw new Error("upstream incomplete"); };
  const unavailable = await f.checking.check("sol-1", f.admin, f.checkInput);
  assert.equal(unavailable.status, "unavailable"); assert.equal(unavailable.canRelease, false);
  assert.equal(f.recoveries.length, 0);
});

it("positive non-delivery evidence permits retry but a confirmed diagnostic ID always prevents release", async () => {
  const f = checkingFixture();
  f.mutate({ administrativeCoreControl: { generationPending: { ...f.reservation, status: "UNCERTAIN", dispatchState: "STARTED" } } });
  f.checkDeps.findLoans = async () => [];
  f.evidence.push({ stage: "ERROR", data: { phase: "REMOTE_CREATION", error: { name: "PrestamoLegacyNotSentError" } } });
  assert.equal((await f.checking.check("sol-1", f.admin, f.checkInput)).canRelease, true);
  f.evidence.push({ stage: "SUCCESS", data: { loanId: "444" } });
  assert.equal((await f.checking.check("sol-1", f.admin, f.checkInput)).canRelease, false);
  await assert.rejects(f.checking.release("sol-1", f.admin, { ...f.checkInput, reason: "Consulta vacía" }));
});

it("a source change during the lookup or a different candidate on confirmation aborts recovery", async () => {
  const f = checkingFixture();
  f.checkDeps.findLoans = async () => { f.mutate({ updatedAt: new Date() }); return []; };
  await assert.rejects(f.checking.check("sol-1", f.admin, f.checkInput), /reserva cambió/);
  const changed = checkingFixture();
  assert.equal((await changed.checking.check("sol-1", changed.admin, changed.checkInput)).candidate?.id, "444");
  changed.checkDeps.findLoans = async () => [{ ...changed.loan, id: "445" }];
  await assert.rejects(changed.checking.recover("sol-1", changed.admin, { ...changed.checkInput, newLoanId: "444", reason: "Comprobado" }), /comprobación cambió/);
  assert.equal(changed.recoveries.length, 0);
});

it("releasing an un-sent reservation fences a live creator paused in REQUEST diagnostics before fetch", async () => {
  const f = fixture();
  let resume!: () => void, began!: () => void, remoteCalls = 0;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  f.deps.gateway = new CrearPrestamoGateway({ baseUrl: "https://core.example.test", timeoutMs: 1000,
    diagnostics: async (_ctx, _event, required) => { if (required) { began(); await paused; } },
  }, async () => { remoteCalls++; return new Response('{"Ok":true,"ID":"444"}'); });
  const original = f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor });
  const rejected = assert.rejects(original);
  await started;
  const p = f.row().administrativeCoreControl.generationPending as { requestId: string };
  const checking = new LoanGenerationCheckService({ db: f.deps.db, generation: f.service, findLoans: async () => [] });
  await checking.release("sol-1", { id: "admin", isSystemAdmin: true, workflowOwnerId: "risk" }, {
    requestId: p.requestId, expectedUpdatedAt: f.row().updatedAt.toISOString(), reason: "Liberación verificada antes del envío",
  });
  resume(); await rejected;
  assert.equal(remoteCalls, 0);
  assert.equal(f.row().legacyOid, null);
  assert.equal(f.row().administrativeCoreControl.generationPending, undefined);
});

it("once dispatch is authorized an empty Core search cannot unlock the still-running creation", async () => {
  const f = fixture();
  let resume!: () => void, began!: () => void, remoteCalls = 0;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  f.deps.gateway = new CrearPrestamoGateway({ baseUrl: "https://core.example.test", timeoutMs: 5000 }, async () => {
    remoteCalls++; began(); await paused; return new Response('{"Ok":true,"ID":"444"}');
  });
  const original = f.service.create(f.prepared, { solicitudId: "sol-1", currentUser: f.actor });
  await started;
  try {
    const p = f.row().administrativeCoreControl.generationPending as { requestId: string; dispatchState: string };
    assert.equal(p.dispatchState, "STARTED");
    const checking = new LoanGenerationCheckService({ db: f.deps.db, generation: f.service, findLoans: async () => [] });
    const actor = { id: "admin", isSystemAdmin: true, workflowOwnerId: "risk" };
    const input = { requestId: p.requestId, expectedUpdatedAt: f.row().updatedAt.toISOString(), reason: "Consulta durante el envío" };
    assert.equal((await checking.check("sol-1", actor, input)).canRelease, false);
    await assert.rejects(checking.release("sol-1", actor, input));
  } finally { resume(); }
  await original;
  assert.equal(remoteCalls, 1); assert.equal(f.row().legacyOid, "444");
});
