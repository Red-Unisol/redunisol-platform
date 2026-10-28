import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import { administrativeCorrectionInput, coreReconciliationInput } from "./AdministrativeCorrectionRoutes";

it("correction input accepts only the permitted destination and excludes client-supplied identity", () => {
  const valid = { targetStateCode: "Revisar", expectedUpdatedAt: new Date().toISOString(), requestId: randomUUID(), reason: "Confirmación realizada por error" };
  assert(administrativeCorrectionInput.safeParse(valid).success);
  for (const patch of [{ targetStateCode: "Pagada" }, { reason: " " }, { isSystemAdmin: true }, { currentUser: { id: randomUUID() } }, { expectedUpdatedAt: "" }])
    assert(!administrativeCorrectionInput.safeParse({ ...valid, ...patch }).success);
  assert(coreReconciliationInput.safeParse({ reason: valid.reason, expectedUpdatedAt: valid.expectedUpdatedAt }).success);
  assert(!coreReconciliationInput.safeParse({ reason: valid.reason, expectedUpdatedAt: valid.expectedUpdatedAt, reconciled: true }).success);
});
