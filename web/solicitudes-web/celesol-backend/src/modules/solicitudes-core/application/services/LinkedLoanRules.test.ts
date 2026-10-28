import assert from "node:assert/strict";
import { it } from "node:test";
import { assertLinkedLoanAmountEditable, assertLinkedLoanReady, inspectLinkedLoan, type LinkedLoanGateways } from "./LinkedLoanRules";

const source = { legacyOid: "444", montoAFinanciar: 500000, titular: { nroDocumento: "12345678" } };
function gateways(overrides: Partial<LinkedLoanGateways> = {}): LinkedLoanGateways {
  return {
    lifecycle: async () => ({ id: "444", account: "100", estado: 0, estadoLabel: "Activa", estadoPrestamo: 0, estadoPrestamoLabel: "Pendiente", vigente: false, saldo: 0 }),
    loanSnapshot: async () => ({ id: "444", estado: 0, amount: 500000, cuotas: 12, lineaId: "77", primerVencimiento: null, cancelacionesCentavos: 0 }),
    ...overrides,
  };
}

it("an active matching loan is reusable but freezes amount for every actor", async () => {
  const result = await inspectLinkedLoan(source, gateways());
  assert.equal(result.status, "active");
  assert.equal(result.matchesAmount, true);
  assert.doesNotThrow(() => assertLinkedLoanReady(result));
  assert.throws(() => assertLinkedLoanAmountEditable(result), /congelado.*444/);
});

it("a mismatch names the loan and both amounts and blocks advancement", async () => {
  const result = await inspectLinkedLoan({ ...source, montoAFinanciar: 600000 }, gateways());
  assert.equal(result.matchesAmount, false);
  assert.throws(() => assertLinkedLoanReady(result), /500.000.*600.000.*444.*Vimarx/);
});

it("proven cancellation permits editing but never advancement, even at same amount", async () => {
  const result = await inspectLinkedLoan(source, gateways({
    lifecycle: async () => ({ id: "444", account: "100", estado: 3, estadoLabel: "Anulada", estadoPrestamo: 0, estadoPrestamoLabel: "Anulado", vigente: false, saldo: 0 }),
    loanSnapshot: async () => { throw new Error("not required to prove cancellation"); },
  }));
  assert.equal(result.status, "cancelled");
  assert.doesNotThrow(() => assertLinkedLoanAmountEditable(result));
  assert.throws(() => assertLinkedLoanReady(result), /anulado.*Regenerá/);
});

it("unknown, contradictory or non-borrower loans never unlock an amount", async () => {
  for (const overrides of [
    { lifecycle: async () => null },
    { lifecycle: async () => { throw new Error("provider down"); } },
    { loanSnapshot: async () => null },
    { loanSnapshot: async () => ({ id: "other", estado: 0, amount: 500000, cuotas: 12, lineaId: "77", primerVencimiento: null, cancelacionesCentavos: 0 }) },
  ]) await assert.rejects(inspectLinkedLoan(source, gateways(overrides)), /No se pudo verificar/);
});

it("no linked loan is editable but not ready, and pending generation blocks even without a loan", async () => {
  const none = await inspectLinkedLoan({ ...source, legacyOid: null }, gateways());
  assert.equal(none.amountEditable, true);
  assert.throws(() => assertLinkedLoanReady(none), /Generá el préstamo/);
  await assert.rejects(inspectLinkedLoan({ ...source, legacyOid: null, administrativeCoreControl: { generationPending: { status: "UNCERTAIN" } } }, gateways()), /generación.*incierto/);
});

it("newly generated or replaced IDs are looked up as loan IDs, not historical requests", async () => {
  let calls = 0;
  const original = gateways();
  await inspectLinkedLoan({ ...source, administrativeCoreControl: { generatedLoanId: "444" } }, gateways({
    lifecycle: async (id, direct) => { assert.equal(direct, true); calls++; return original.lifecycle(id, direct); },
    loanSnapshot: async (id, dni, direct) => { assert.equal(direct, true); calls++; return original.loanSnapshot(id, dni, direct); },
  }));
  assert.equal(calls, 2);
});
