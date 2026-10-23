import assert from "node:assert/strict";
import { it } from "node:test";
import { loanReplacementInput, loanReplacementRecoveryInput } from "./ControlledLoanReplacementRoutes";
it("replacement commands require version, UUID, numeric ID and reason without accepting bypass flags", () => {
  const input = { requestId: "9d98a396-4091-4898-8232-9402b6f53c11", expectedUpdatedAt: "2026-10-23T12:00:00.000Z", previousLoanId: "443417", reason: "Anulado por corrección de monto" };
  assert(loanReplacementInput.safeParse(input).success);
  for (const patch of [{ requestId: "invalid" }, { expectedUpdatedAt: "" }, { previousLoanId: "0" }, { reason: "   " }, { skipCancellationCheck: true }])
    assert(!loanReplacementInput.safeParse({ ...input, ...patch }).success);
  const recovery = { requestId: input.requestId, expectedUpdatedAt: input.expectedUpdatedAt, reason: input.reason };
  assert(loanReplacementRecoveryInput.safeParse({ ...recovery, newLoanId: "443418" }).success);
  assert(!loanReplacementRecoveryInput.safeParse({ ...recovery, newLoanId: "-1" }).success);
});
