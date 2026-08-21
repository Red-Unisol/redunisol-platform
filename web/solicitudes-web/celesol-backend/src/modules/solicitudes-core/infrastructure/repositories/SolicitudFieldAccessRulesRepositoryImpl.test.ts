import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudFieldAccessRulesRepositoryImpl } from "./SolicitudFieldAccessRulesRepositoryImpl";

describe("SolicitudFieldAccessRulesRepositoryImpl", () => {
  it("loads multiple workflow state rules with a single datasource call", async () => {
    const calls: string[][] = [];
    const repository = new SolicitudFieldAccessRulesRepositoryImpl({
      findByWorkflowStateId: async () => {
        throw new Error("not used");
      },
      findByWorkflowStateIds: async (workflowStateIds: string[]) => {
        calls.push([...workflowStateIds]);

        return [
          {
            active: true,
            backgroundColor: "#FF7F7F",
            canManageAttachments: true,
            defaultMode: "readonly",
            editableFields: [],
            editableGroups: [],
            readonlyReason: null,
            textColor: "#000000",
            workflowStateId: "state-rechazada",
          },
        ];
      },
    } as never);

    const result = await repository.findByWorkflowStateIds([
      "state-rechazada",
      "state-preaprobada",
    ]);

    assert.deepEqual(calls, [["state-rechazada", "state-preaprobada"]]);
    assert.deepEqual(result, [
      {
        active: true,
        backgroundColor: "#FF7F7F",
        canManageAttachments: true,
        defaultMode: "readonly",
        editableFields: [],
        editableGroups: [],
        readonlyReason: null,
        textColor: "#000000",
        workflowStateId: "state-rechazada",
      },
    ]);
  });
});
