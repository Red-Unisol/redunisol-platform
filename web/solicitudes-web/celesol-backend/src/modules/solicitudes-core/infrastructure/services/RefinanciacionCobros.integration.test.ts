import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { SolicitudesCorePrismaDatasource } from "../datasources/SolicitudesCorePrismaDatasource";
import { SolicitudRefinanciacionPrismaRepository } from "../repositories/SolicitudRefinanciacionPrismaRepository";
import { GuardarSolicitudRefinanciacionUseCase } from "../../application/use-cases/GuardarSolicitudRefinanciacion.use-case";
import { CobrarRefinanciacionSolicitud } from "../../application/services/CobrarRefinanciacionSolicitud";
import { PrestamoLegacyRechazadoError, PrestamoLegacyUnavailableError } from "../../domain/solicitudes-core-errors";
import { refinanciacionVersion } from "../../domain/repositories/SolicitudRefinanciacionRepository";
import { actingContext } from "../../../auth/impersonation/context";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import type { CobrarPrestamoGateway } from "./CobrarPrestamoGateway";
import { InitialLoanGenerationService, type PreparedInitialLoan } from "./InitialLoanGenerationService";
import { administrativeSource } from "./AdministrativeCorrectionService";
import { RefinanciacionCobrosService } from "./RefinanciacionCobrosService";

const enabled = Boolean(process.env.BEEX_TEST_DATABASE_URL);
const db = new PrismaClient({ datasourceUrl: process.env.BEEX_TEST_DATABASE_URL });
after(() => db.$disconnect());
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};
const simulation = async () => ({ prestamos: [], total: 100 });

async function fixture() {
  const url = new URL(process.env.BEEX_TEST_DATABASE_URL!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_test"));
  const state = await db.workflowState.findUniqueOrThrow({ where: { code: "Confirmada" } });
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", workflowOwnerId: state.ownerId } });
  const admin = await db.user.create({ data: { email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", isSystemAdmin: true } });
  const s = await db.solicitud.create({ data: {
    createdBy: user.id, estadoActualId: state.id, montoAFinanciar: 500000, cuotas: 12,
    lineaPrestamoLegacyOid: "55", lineaPrestamoDescripcion: "Test", titular: { create: { nroDocumento: "12345678" } },
  } });
  const repository = new SolicitudesCorePrismaDatasource(db);
  const refi = new SolicitudRefinanciacionPrismaRepository(db);
  const input = { solicitudId: s.id, currentUser: { id: user.id, isSystemAdmin: false, workflowOwnerId: state.ownerId, workflowOwnerCode: "RIESGO" } };
  const administrator = { id: admin.id, isSystemAdmin: true };
  let legacyCuotas = [24, 25].map(nroCuota => ({ nroCuota, fecha: "2026-11-30", fechaCobro: null as string | null, saldoCuota: 100 }));
  const journal = new RefinanciacionCobrosService({ db, timeoutMs: 50, legacyGateway: { listCuotasDelPrestamo: async () => legacyCuotas as never } });
  let chargeCalls = 0, loanCalls = 0;
  const loanId = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  let charge: CobrarPrestamoGateway["cobrar"] = async () => ({ capital: 100, interes: 0, otros: 0, punitorios: 0, totalPago: 100, cuotas: [], cobroId: "99123" });
  const cobrador = new CobrarRefinanciacionSolicitud({
    refinanciacionRepository: refi, registroCobros: journal, hoy: () => "2026-10-29",
    legacyGateway: { listCuotasDelPrestamo: async () => legacyCuotas as never },
    simularRefinanciacion: { execute: simulation },
    cobrarPrestamoGateway: { cobrar: async value => { chargeCalls++; return charge(value); } },
  });
  const initial = new InitialLoanGenerationService({
    db, repository, gateway: { crear: async () => { loanCalls++; return { id: loanId }; } },
    linkedLoanReader: async () => ({ status: "active", currentLoanId: loanId, resolvedLoanId: loanId, amount: 500000, requestedAmount: 500000, matchesAmount: true, amountEditable: false }),
    loanSnapshot: async () => null, makeSignatureLink: id => `https://example.test/${id}`,
  });
  const replace = async (nrosCuota: number[]) => {
    const current = await repository.findById(s.id);
    return refi.replace({ solicitudId: s.id, updatedBy: user.id, expectedSolicitudUpdatedAt: current!.updatedAt,
      expectedVersion: refinanciacionVersion(await refi.findBySolicitudId(s.id)),
      prestamos: nrosCuota.length ? [{ prestamoId: "123", nrosCuota }] : [],
    });
  };
  const prepare = async (): Promise<PreparedInitialLoan> => {
    const solicitud = (await repository.findById(s.id))!;
    const prepared = await cobrador.preparar(s.id);
    return { solicitud, codigoMutual: "test", refinanciacionVersion: prepared.version,
      coreInput: { cuotas: 12, fechaEmision: "2026-10-29", integrantes: [{ socio: "77", tipoRelacion: "Titular" }], lineaPrestamo: "88", montoDeseado: 500000, vendedor: "5" },
      ...(prepared.pendientes.length ? { antesDeCrear: context => cobrador.cobrar(s.id, prepared, context) } : {}),
    };
  };
  const age = async () => {
    const source = await administrativeSource(db, s.id);
    const control = source.administrativeCoreControl as Prisma.JsonObject;
    const pending = control.generationPending as Prisma.JsonObject;
    const operation = pending.refinanciacionCobro as Prisma.JsonObject;
    await db.solicitud.update({ where: { id: s.id }, data: { administrativeCoreControl: {
      ...control, generationPending: { ...pending, refinanciacionCobro: { ...operation, startedAt: "2000-01-01T00:00:00.000Z" } },
    } } });
    return journal.inspect(s.id, administrator);
  };
  const clean = async () => {
    await db.beexNotification.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitudEstadoHistorial.deleteMany({ where: { solicitudId: s.id } });
    await db.solicitud.delete({ where: { id: s.id } });
    await db.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } });
  };
  return { s, refi, repository, input, administrator, journal, initial, cobrador, prepare, replace, age, clean,
    calls: () => ({ chargeCalls, loanCalls }), setCharge: (fn: typeof charge) => { charge = fn; },
    paid: () => { legacyCuotas = legacyCuotas.map(c => ({ ...c, fechaCobro: "2026-10-29", saldoCuota: 0 })); },
    unreported: () => { legacyCuotas = []; },
    mixed: () => { legacyCuotas[0].fecha = "2026-09-30"; },
  };
}

it("a save delayed by simulation cannot erase confirmed charges after loan generation", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture(), started = gate(), resume = gate();
  try {
    await f.replace([24]);
    const save = new GuardarSolicitudRefinanciacionUseCase({ repository: f.repository,
      fieldAccessRulesRepository: { findByWorkflowStateId: async () => ({ active: true, canManageAttachments: true }) as never },
      refinanciacionRepository: f.refi,
      simularRefinanciacion: { execute: async () => { started.release(); await resume.promise; return simulation(); } },
    });
    const saving = save.execute({ ...f.input, prestamos: [{ prestamoId: "123", nrosCuota: [25] }] });
    await started.promise;
    await f.initial.create(await f.prepare(), f.input);
    resume.release();
    await assert.rejects(saving, /ya fue generado/);
    const saved = await f.refi.findBySolicitudId(f.s.id);
    assert.deepEqual(saved.prestamos[0].nrosCuota, [24]);
    assert.equal(saved.prestamos[0].cobros[0].cobroId, "99123");
    assert.deepEqual(f.calls(), { chargeCalls: 1, loanCalls: 1 });
  } finally { resume.release(); await f.clean(); }
});

it("adding a refinance selection invalidates an earlier empty preparation before any loan or charge", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const prepared = await f.prepare();
    await f.replace([24]);
    await assert.rejects(f.initial.create(prepared, f.input), /refinanciación cambió/);
    assert.deepEqual(f.calls(), { chargeCalls: 0, loanCalls: 0 });
  } finally { await f.clean(); }
});

it("two concurrent saves of the same version cannot silently overwrite one another", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const s = (await f.repository.findById(f.s.id))!;
    const base = { solicitudId: f.s.id, updatedBy: f.input.currentUser.id, expectedSolicitudUpdatedAt: s.updatedAt, expectedVersion: refinanciacionVersion(await f.refi.findBySolicitudId(f.s.id)) };
    const results = await Promise.allSettled([24, 25].map(n => f.refi.replace({ ...base, prestamos: [{ prestamoId: "123", nrosCuota: [n] }] })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1);
  } finally { await f.clean(); }
});

it("the durable charge intent blocks both edits and concurrent generation before the remote call returns", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture(), started = gate(), resume = gate();
  try {
    await f.replace([24]);
    f.setCharge(async () => { started.release(); await resume.promise; return { cobroId: "99123", totalPago: 100 } as never; });
    const prepared = await f.prepare();
    const generating = f.initial.create(prepared, f.input);
    await started.promise;
    assert.equal((await f.journal.inspect(f.s.id, f.administrator)).pending?.status, "PENDING");
    await assert.rejects(f.replace([]), /generación.*incierto/);
    await assert.rejects(f.initial.create(prepared, f.input), /generación.*incierto/);
    resume.release(); await generating;
    assert.deepEqual(f.calls(), { chargeCalls: 1, loanCalls: 1 });
  } finally { resume.release(); await f.clean(); }
});

it("a timeout after remote payment stays locked and can be reconciled once, without charging again", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.replace([24]);
    f.setCharge(async () => { f.paid(); throw new PrestamoLegacyUnavailableError(); });
    await assert.rejects(f.initial.create(await f.prepare(), f.input), /quedó bloqueada/);
    assert.deepEqual(f.calls(), { chargeCalls: 1, loanCalls: 0 });
    await assert.rejects(f.replace([]), /generación.*incierto/);
    await assert.rejects(f.initial.create(await f.prepare(), f.input), /generación.*incierto/);
    await assert.rejects(f.journal.inspect(f.s.id, f.input.currentUser), /administrador/);
    const fresh = await f.journal.inspect(f.s.id, f.administrator);
    const recover = { operationId: fresh.pending!.operationId, expectedUpdatedAt: fresh.expectedUpdatedAt, resolution: "CONFIRMED" as const, cobroId: "99123", totalCobrado: 100, reason: "Verificado el comprobante y el cobrador Refinanciacion en Vimarx" };
    await assert.rejects(f.journal.recover(f.s.id, f.administrator, recover), /todavía puede estar en curso/);
    const aged = await f.age();
    await assert.rejects(f.journal.recover(f.s.id, f.administrator, { ...recover, expectedUpdatedAt: aged.expectedUpdatedAt, resolution: "NOT_APPLIED" }), /cuotas de Vimarx/);
    await assert.rejects(f.journal.recover(f.s.id, f.administrator, recover), /cambió/);
    const confirmed = { ...recover, expectedUpdatedAt: aged.expectedUpdatedAt };
    await f.journal.recover(f.s.id, f.administrator, confirmed);
    await assert.rejects(f.journal.recover(f.s.id, f.administrator, confirmed), /reserva del cobro cambió/);
    await f.initial.create(await f.prepare(), f.input);
    assert.deepEqual(f.calls(), { chargeCalls: 1, loanCalls: 1 });
    const record = await db.solicitudEstadoHistorial.findFirstOrThrow({ where: { solicitudId: f.s.id, actionCode: "REFINANCIACION_COBRO_RECOVERED" } });
    assert.equal(record.changedBy, f.administrator.id);
    assert.equal(record.comentario, recover.reason);
  } finally { await f.clean(); }
});

it("a charge proven not applied is released for a new attempt, and incomplete evidence never unlocks it", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.replace([24]);
    f.setCharge(async () => { throw new PrestamoLegacyUnavailableError(); });
    await assert.rejects(f.initial.create(await f.prepare(), f.input));
    const aged = await f.age();
    const recover = { operationId: aged.pending!.operationId, expectedUpdatedAt: aged.expectedUpdatedAt, resolution: "NOT_APPLIED" as const, reason: "Verificada ausencia del cobro en la cuenta y cuotas de Vimarx" };
    await assert.rejects(f.journal.recover(f.s.id, f.input.currentUser, recover), /administrador/);
    const impersonated = { id: f.administrator.id } as AuthUser;
    await actingContext.run({ administrator: impersonated, selectedUser: impersonated, sessionId: randomUUID(), auditId: randomUUID() }, async () => {
      await assert.rejects(f.journal.recover(f.s.id, f.administrator, recover), /propia sesión/);
    });
    f.unreported();
    await assert.rejects(f.journal.recover(f.s.id, f.administrator, recover), /cuotas de Vimarx/);
    assert((await f.journal.inspect(f.s.id, f.administrator)).pending);
    // Restore the explicit unpaid evidence, then reconcile.
    const service = new RefinanciacionCobrosService({ db, timeoutMs: 50, legacyGateway: { listCuotasDelPrestamo: async () => [{ nroCuota: 24, saldoCuota: 100, fechaCobro: null }] as never } });
    await service.recover(f.s.id, f.administrator, recover);
    await f.replace([]);
    await f.initial.create(await f.prepare(), f.input);
    assert.deepEqual(f.calls(), { chargeCalls: 1, loanCalls: 1 });
  } finally { await f.clean(); }
});

it("an explicit rejection releases the reservation without creating a loan", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.replace([24]);
    f.setCharge(async () => { throw new PrestamoLegacyRechazadoError("Cuota rechazada"); });
    await assert.rejects(f.initial.create(await f.prepare(), f.input), /rechazó/);
    assert.equal((await f.journal.inspect(f.s.id, f.administrator)).pending, null);
    await f.replace([]);
    assert.deepEqual(f.calls(), { chargeCalls: 1, loanCalls: 0 });
  } finally { await f.clean(); }
});

it("a failed local confirmation keeps the returned receipt and cannot be recovered as not applied", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.replace([24]); f.paid();
    f.journal.confirmar = async () => { throw new Error("local persistence failed"); };
    await assert.rejects(f.initial.create(await f.prepare(), f.input), /No se pudo registrar el cobro 99123/);
    const aged = await f.age();
    assert.equal(aged.pending?.response?.cobroId, "99123");
    const recover = { operationId: aged.pending!.operationId, expectedUpdatedAt: aged.expectedUpdatedAt, resolution: "CONFIRMED" as const, cobroId: "99124", totalCobrado: 100, reason: "Comprobante verificado en Vimarx por administración" };
    await assert.rejects(f.journal.recover(f.s.id, f.administrator, recover), /respuesta de cobro registrada/);
    await f.journal.recover(f.s.id, f.administrator, { ...recover, cobroId: "99123" });
    await f.initial.create(await f.prepare(), f.input);
    assert.deepEqual(f.calls(), { chargeCalls: 1, loanCalls: 1 });
  } finally { await f.clean(); }
});

it("a process crash or failed uncertainty write leaves the durable PENDING intent recoverable", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.replace([24]);
    f.journal.marcarIncierto = async () => { throw new Error("database temporarily unavailable"); };
    f.setCharge(async () => { throw new PrestamoLegacyUnavailableError(); });
    await assert.rejects(f.initial.create(await f.prepare(), f.input), /quedó bloqueada/);
    const aged = await f.age();
    assert.equal(aged.pending!.status, "PENDING");
    await assert.rejects(f.initial.recover(f.s.id, { ...f.administrator, workflowOwnerId: "" }, { requestId: randomUUID(), expectedUpdatedAt: aged.expectedUpdatedAt, newLoanId: "999", reason: "No se debe recuperar como un préstamo generado" }), /recuperación de refinanciación/);
    await f.journal.recover(f.s.id, f.administrator, { operationId: aged.pending!.operationId, expectedUpdatedAt: aged.expectedUpdatedAt, resolution: "NOT_APPLIED", reason: "Verificada ausencia de cobro y cuotas aún pendientes" });
    assert.equal((await f.journal.inspect(f.s.id, f.administrator)).pending, null);
  } finally { await f.clean(); }
});

it("a malformed success response remains uncertain and does not prevent reconciliation with valid evidence", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.replace([24]); f.paid();
    f.setCharge(async () => ({ cobroId: "0", totalPago: 0 }) as never);
    await assert.rejects(f.initial.create(await f.prepare(), f.input), /No se pudo registrar/);
    const aged = await f.age();
    assert.equal(aged.pending?.response, undefined);
    await f.journal.recover(f.s.id, f.administrator, { operationId: aged.pending!.operationId, expectedUpdatedAt: aged.expectedUpdatedAt, resolution: "CONFIRMED", cobroId: "99123", totalCobrado: 100, reason: "Comprobante real verificado ante respuesta inválida de Vimarx" });
    await f.initial.create(await f.prepare(), f.input);
    assert.deepEqual(f.calls(), { chargeCalls: 1, loanCalls: 1 });
  } finally { await f.clean(); }
});

it("a partial rejection preserves the first charge and a retry collects only the remaining cuotas", { skip: !enabled, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.replace([24, 25]); f.mixed();
    f.setCharge(async input => {
      if (input.nrosCuota.includes(25)) throw new PrestamoLegacyRechazadoError("Rechazo del segundo tramo");
      return { cobroId: "99124", totalPago: 100 } as never;
    });
    await assert.rejects(f.initial.create(await f.prepare(), f.input), /1 de 2 cobros/);
    assert.equal((await f.refi.findBySolicitudId(f.s.id)).prestamos[0].cobros.length, 1);
    await assert.rejects(f.replace([]), /Ya se cobraron/);
    f.setCharge(async input => {
      assert.deepEqual(input.nrosCuota, [25]);
      return { cobroId: "99125", totalPago: 100 } as never;
    });
    await f.initial.create(await f.prepare(), f.input);
    assert.deepEqual(f.calls(), { chargeCalls: 3, loanCalls: 1 });
    assert.equal((await f.refi.findBySolicitudId(f.s.id)).prestamos[0].cobros.length, 2);
  } finally { await f.clean(); }
});
