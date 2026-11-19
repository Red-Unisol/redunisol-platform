import assert from "node:assert/strict";
import { it } from "node:test";
import { hasWorkflowArea, hasWorkflowAreaId } from "./workflow-areas";

it("lee los roles vigentes de sesiones y revalidaciones sin reactivar un área revocada", () => {
  const risk = { code: "RIESGO", id: "r" };
  const treasury = { code: "TESORERIA", id: "t" };
  const disabled = { ...risk, isActive: false };
  assert.equal(hasWorkflowArea({ workflowOwner: treasury }, "TESORERIA"), true);
  assert.equal(hasWorkflowAreaId({ workflowOwnerId: "t" }, "t"), true);
  assert.equal(hasWorkflowArea({ workflowOwner: treasury, workflowOwners: [] }, "TESORERIA"), false);
  const user = {
    workflowOwner: treasury,
    workflowOwnerMemberships: [{ workflowOwner: disabled }, { workflowOwner: treasury }],
  };
  assert.equal(hasWorkflowArea(user, "RIESGO"), false);
  assert.equal(hasWorkflowAreaId(user, "r"), false);
  assert.equal(hasWorkflowArea(user, "TESORERIA"), true);
  assert.equal(hasWorkflowArea({ workflowOwners: [treasury, risk] }, "RIESGO"), true);
});
