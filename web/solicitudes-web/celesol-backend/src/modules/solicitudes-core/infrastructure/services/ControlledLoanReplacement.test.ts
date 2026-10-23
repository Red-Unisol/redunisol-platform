import assert from "node:assert/strict";
import { it } from "node:test";
import { assertCancelledLoan, type CoreLoanLifecycle } from "./ControlledLoanReplacementService";
it("only a fully proven cancelled loan with zero balance can be replaced", () => {
  const loan: CoreLoanLifecycle = { id: "443417", account: "1016127", estado: 3, estadoLabel: "Anulada", estadoPrestamo: 0, estadoPrestamoLabel: "Anulado", vigente: false, saldo: 0 };
  assert.doesNotThrow(() => assertCancelledLoan(loan));
  assert.throws(() => assertCancelledLoan(null));
  for (const patch of [{ id: null }, { estadoLabel: null }, { estadoPrestamoLabel: "Pendiente" }, { vigente: true }, { vigente: null }, { saldo: 1 }, { saldo: null }])
    assert.throws(() => assertCancelledLoan({ ...loan, ...patch }));
});
