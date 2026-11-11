import assert from "node:assert/strict";
import { it } from "node:test";
import { assertReliquidationCancellation } from "./LoanReliquidation";
import { assertNoLoanReplacementPending } from "./AdministrativeCorrection";

it("reliquidation accepts only explicit cancellation of the expected loan with zero balance", () => {
  const loan = { id: "55", estadoLabel: "Anulado", estadoPrestamoLabel: "Anulado", vigente: false, saldo: 0 };
  assert.doesNotThrow(() => assertReliquidationCancellation(loan, "55"));
  for (const candidate of [null, { ...loan, id: "56" }, { ...loan, estadoLabel: null },
    { ...loan, estadoPrestamoLabel: "Activo" }, { ...loan, vigente: null }, { ...loan, vigente: true },
    { ...loan, saldo: null }, { ...loan, saldo: 0.01 }])
    assert.throws(() => assertReliquidationCancellation(candidate, "55"), /Vimarx debe confirmar/);
});

it("the durable preparation blocks writes even when the original loan is still linked", () => {
  assert.throws(() => assertNoLoanReplacementPending({ administrativeCoreControl: { reliquidationHold: { requestId: "one" } } }), /pausada/);
});
