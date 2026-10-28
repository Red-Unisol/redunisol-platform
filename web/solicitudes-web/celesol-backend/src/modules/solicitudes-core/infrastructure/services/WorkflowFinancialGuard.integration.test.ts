import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertSignatureLinkFinancialReady } from "./WorkflowFinancialGuard";
import { administrativeSource } from "./AdministrativeCorrectionService";
import { coreReconciliationPending } from "../../domain/workflow/AdministrativeCorrection";

const enabled = Boolean(process.env.BEEX_TEST_DATABASE_URL);
const db = new PrismaClient({ datasourceUrl: process.env.BEEX_TEST_DATABASE_URL });
after(() => db.$disconnect());

it("a returned linked request remains signable with verified Core conditions without reconciling or mutating it", { skip: !enabled }, async () => {
  const url = new URL(process.env.BEEX_TEST_DATABASE_URL!);
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"));
  const state = await db.workflowState.findUniqueOrThrow({ where: { code: "Revisar" } });
  const actor = await db.user.create({ data: { email: `${randomUUID()}@example.test`, legacyUser: randomUUID(), passwordHash: "test", workflowOwnerId: state.ownerId } });
  const loanId = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const row = await db.solicitud.create({ data: {
    createdBy: actor.id, estadoActualId: state.id, legacyOid: loanId, montoAFinanciar: 500000, cuotas: 12,
    lineaPrestamoLegacyOid: "55", lineaPrestamoDescripcion: "Línea", fechaPrimerVencimiento: new Date("2026-11-30"),
    administrativeCoreControl: { correctionId: randomUUID(), loanId, reconciledFingerprint: null },
    titular: { create: { nroDocumento: "12345678" } },
    cancelaciones: { create: { cuentaADebitar: "x", cbu: "x", cuentaBancaria: "x", socio: "Titular", monto: 10000 } },
  } });
  const deps: NonNullable<Parameters<typeof assertSignatureLinkFinancialReady>[2]> = {
    lifecycle: async () => ({ id: loanId, account: "100", estado: 0, estadoLabel: "Activa", estadoPrestamo: 0, estadoPrestamoLabel: "Pendiente", vigente: false, saldo: 0 }),
    loanSnapshot: async (_loan, document) => { assert.equal(document, "12345678"); return { id: loanId, estado: 0, amount: 500000, cuotas: 12, lineaId: "88", primerVencimiento: "2026-11-30", cancelacionesCentavos: 1000000 }; },
    lineResolver: { resolveByPresolicitudOid: async () => ({ id: "88", codigoMutual: "amejuca" }) },
  };
  try {
    const before = await administrativeSource(db, row.id);
    assert.equal(coreReconciliationPending(before), true);
    const proof = await assertSignatureLinkFinancialReady(db, row.id, deps);
    assert.equal(proof.loanId, loanId);
    const after = await administrativeSource(db, row.id);
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
    assert.equal(after.estadoActual.code, "Revisar");
    assert.equal(coreReconciliationPending(after), true);
    assert.deepEqual(after.administrativeCoreControl, before.administrativeCoreControl);
    assert.equal(await db.solicitudEstadoHistorial.count({ where: { solicitudId: row.id } }), 0);
    assert.equal(await db.beexNotification.count({ where: { solicitudId: row.id } }), 0);
    const snapshot = deps.loanSnapshot;
    deps.loanSnapshot = async (...args) => ({ ...(await snapshot(...args))!, amount: 900000 });
    await assert.rejects(assertSignatureLinkFinancialReady(db, row.id, deps), /monto distinto/);
    deps.loanSnapshot = snapshot;
    deps.lifecycle = async () => ({ id: loanId, account: "100", estado: 3, estadoLabel: "Anulada", estadoPrestamo: 0, estadoPrestamoLabel: "Anulado", vigente: false, saldo: 0 });
    await assert.rejects(assertSignatureLinkFinancialReady(db, row.id, deps), /anulado/);
    const unchanged = await administrativeSource(db, row.id);
    assert.equal(unchanged.updatedAt.getTime(), before.updatedAt.getTime());
    assert.deepEqual(unchanged.administrativeCoreControl, before.administrativeCoreControl);
  } finally {
    await db.solicitud.delete({ where: { id: row.id } });
    await db.user.delete({ where: { id: actor.id } });
  }
});
