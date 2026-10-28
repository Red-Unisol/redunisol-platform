import assert from "node:assert/strict";
import { it } from "node:test";
import type { Prisma } from "@prisma/client";
import { assertSignatureLinkFinancialReady, assertWorkflowFinancialReady } from "./WorkflowFinancialGuard";
import { coreConditionsFingerprint, coreReconciliationPending } from "../../domain/workflow/AdministrativeCorrection";
import type { CoreLoanSnapshot } from "./AdministrativeCorrectionService";

function fixture() {
  const row = {
    id: "s", legacyOid: "444", estadoActualId: "confirmed", updatedAt: new Date("2026-10-26T00:00:00Z"),
    montoAFinanciar: 500000, cuotas: 12, lineaPrestamoLegacyOid: "55", fechaPrimerVencimiento: new Date("2026-11-30"),
    titular: { nroDocumento: "12345678", cuit: null, nroSocio: null },
    administrativeCoreControl: { correctionId: "correction", loanId: "444", reconciledFingerprint: null as string | null },
    cancelaciones: [{ id: "cancel", monto: 10000, deletedAt: null }], archivedAt: null, desembolso: null, pagoExterno: null,
    estadoActual: { code: "Confirmada", name: "Confirmada", ownerId: "risk", owner: { id: "risk", code: "RIESGO", name: "Riesgo" } },
  };
  let writes = 0;
  const audits: Array<Record<string, unknown>> = [];
  let actor = { id: "operator", state: 1, deletedAt: null, isSystemAdmin: false, workflowOwnerId: "risk", workflowOwner: { code: "RIESGO" } };
  const db = {
    $queryRaw: async () => [],
    solicitud: {
      findUnique: async () => structuredClone(row),
      update: async (input: { data: { administrativeCoreControl: typeof row.administrativeCoreControl } }) => { writes++; row.administrativeCoreControl = input.data.administrativeCoreControl; return structuredClone(row); },
    },
    user: { findFirst: async () => actor },
    solicitudEstadoHistorial: { create: async (input: { data: Record<string, unknown> }) => { audits.push(input.data); return input.data; } },
  } as unknown as Prisma.TransactionClient;
  let proof: CoreLoanSnapshot = { id: "444", estado: 0, amount: 500000, cuotas: 12, lineaId: "88", primerVencimiento: "2026-11-30", cancelacionesCentavos: 1000000 };
  const deps: NonNullable<Parameters<typeof assertWorkflowFinancialReady>[3]> = {
    lifecycle: async () => ({ id: "444", account: "100", estado: 0, estadoLabel: "Activa", estadoPrestamo: 0, estadoPrestamoLabel: "Pendiente", vigente: false, saldo: 0 }),
    loanSnapshot: async (_id, document) => { assert.equal(document, "12345678"); return proof; },
    lineResolver: { resolveByPresolicitudOid: async id => { assert.equal(id, "55"); return { id: "88", codigoMutual: "amejuca" }; } },
  };
  return { row, db, deps, audits, writes: () => writes, setProof: (next: Partial<CoreLoanSnapshot>) => { proof = { ...proof, ...next }; },
    setActor: (next: Partial<typeof actor>) => { actor = { ...actor, ...next }; } };
}

it("a normal authorized actor reconciles only complete matching Core evidence and leaves an auditable snapshot", async () => {
  const f = fixture();
  assert.equal(coreReconciliationPending(f.row), true);
  await assertWorkflowFinancialReady(f.db, f.row.id, "operator", f.deps);
  assert.equal(coreReconciliationPending(f.row), false);
  assert.equal(f.writes(), 1);
  assert.equal(f.audits.length, 1);
  assert.equal(f.audits[0]!.changedBy, "operator");
  assert.equal((f.audits[0]!.metadata as { verifiedLoan: CoreLoanSnapshot }).verifiedLoan.lineaId, "88");
  assert.equal(f.audits[0]!.estadoAnteriorId, f.audits[0]!.estadoNuevoId);
});

it("mismatched amount, installments, line, due date, cancellations or inactive loan never clear reconciliation", async () => {
  for (const patch of [
    { amount: 600000 }, { cuotas: 24 }, { lineaId: "other" }, { primerVencimiento: "2027-01-01" },
    { cancelacionesCentavos: 0 }, { estado: 3 }, { amount: null },
  ]) {
    const f = fixture(); f.setProof(patch);
    await assert.rejects(assertWorkflowFinancialReady(f.db, f.row.id, "operator", f.deps));
    assert.equal(f.writes(), 0);
    assert.equal(f.audits.length, 0);
    assert.equal(coreReconciliationPending(f.row), true);
  }
});

it("unavailable evidence, unavailable line mapping or an unauthorized actor cannot reconcile", async () => {
  const unavailable = fixture(); unavailable.deps.loanSnapshot = async () => null;
  await assert.rejects(assertWorkflowFinancialReady(unavailable.db, "s", "operator", unavailable.deps));
  assert.equal(unavailable.writes(), 0);
  const missingLine = fixture(); missingLine.deps.lineResolver = { resolveByPresolicitudOid: async () => null };
  await assert.rejects(assertWorkflowFinancialReady(missingLine.db, "s", "operator", missingLine.deps), /conciliarse/);
  assert.equal(missingLine.writes(), 0);
  const unauthorized = fixture(); unauthorized.setActor({ workflowOwnerId: "seller" });
  await assert.rejects(assertWorkflowFinancialReady(unauthorized.db, "s", "operator", unauthorized.deps), /permiso/);
  assert.equal(unauthorized.writes(), 0);
});

it("the transaction rejects a source changed during external checks", async () => {
  const f = fixture();
  const resolveLine = f.deps.lineResolver.resolveByPresolicitudOid;
  f.deps.lineResolver.resolveByPresolicitudOid = async id => { f.row.updatedAt = new Date(f.row.updatedAt.getTime() + 1); return resolveLine(id); };
  await assert.rejects(assertWorkflowFinancialReady(f.db, "s", "operator", f.deps), /cambió durante/);
  assert.equal(f.writes(), 0);
  assert.equal(coreReconciliationPending(f.row), true);
});

it("an already reconciled loan is still checked as active, without duplicate reconciliation audits", async () => {
  const f = fixture();
  f.row.administrativeCoreControl.reconciledFingerprint = coreConditionsFingerprint(f.row);
  await assertWorkflowFinancialReady(f.db, "s", "operator", f.deps);
  assert.equal(f.writes(), 0);
  f.setProof({ estado: 3 });
  await assert.rejects(assertWorkflowFinancialReady(f.db, "s", "operator", f.deps));
  assert.equal(f.writes(), 0);
});

it("a returned request can serve a fully verified signature while reconciliation remains pending, without writes", async () => {
  const f = fixture();
  f.row.estadoActual.code = "Revisar";
  const result = await assertSignatureLinkFinancialReady(f.db, "s", f.deps);
  assert.deepEqual(result, { loanId: "444", conditionsFingerprint: coreConditionsFingerprint(f.row) });
  assert.equal(coreReconciliationPending(f.row), true);
  assert.equal(f.writes(), 0);
  assert.equal(f.audits.length, 0);
});

it("signature links reject mismatched contracts, cancelled loans and terminal/archived requests without writes", async () => {
  for (const patch of [{ amount: 600000 }, { cuotas: 24 }, { lineaId: "other" }, { primerVencimiento: "2027-01-01" }, { cancelacionesCentavos: 0 }, { estado: 3 }]) {
    const f = fixture(); f.setProof(patch);
    await assert.rejects(assertSignatureLinkFinancialReady(f.db, "s", f.deps));
    assert.equal(f.writes(), 0);
  }
  const cancelled = fixture();
  cancelled.deps.lifecycle = async () => ({ id: "444", account: "100", estado: 3, estadoLabel: "Anulada", estadoPrestamo: 0, estadoPrestamoLabel: "Anulado", vigente: false, saldo: 0 });
  await assert.rejects(assertSignatureLinkFinancialReady(cancelled.db, "s", cancelled.deps), /anulado/);
  for (const state of ["Pagada", "Desestimada", "Rechazada", "Vencida"]) {
    const terminal = fixture(); terminal.row.estadoActual.code = state;
    await assert.rejects(assertSignatureLinkFinancialReady(terminal.db, "s", terminal.deps), /estado actual/);
    assert.equal(terminal.writes(), 0);
  }
  const archived = fixture(); Object.assign(archived.row, { archivedAt: new Date() });
  await assert.rejects(assertSignatureLinkFinancialReady(archived.db, "s", archived.deps), /estado actual/);
  assert.equal(archived.writes(), 0);
});
