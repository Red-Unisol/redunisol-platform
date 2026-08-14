import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudFieldAccessRulesPrismaDatasource } from "./SolicitudFieldAccessRulesPrismaDatasource";

describe("SolicitudFieldAccessRulesPrismaDatasource", () => {
  it("loads requested workflow states with a single findMany query", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const datasource = new SolicitudFieldAccessRulesPrismaDatasource({
      solicitudFieldAccessRule: {
        findMany: async (input: Record<string, unknown>) => {
          calls.push(input);
          return [];
        },
        findUnique: async () => null,
      },
    } as never);

    await datasource.findByWorkflowStateIds([
      "state-rechazada",
      "state-preaprobada",
    ]);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      select: {
        active: true,
        backgroundColor: true,
        canManageAttachments: true,
        defaultMode: true,
        editableFields: true,
        editableGroups: true,
        readonlyReason: true,
        textColor: true,
        workflowStateId: true,
      },
      where: {
        workflowStateId: {
          in: ["state-rechazada", "state-preaprobada"],
        },
      },
    });
  });

  it("skips prisma queries when there are no workflow states to resolve", async () => {
    let calls = 0;
    const datasource = new SolicitudFieldAccessRulesPrismaDatasource({
      solicitudFieldAccessRule: {
        findMany: async () => {
          calls += 1;
          return [];
        },
        findUnique: async () => null,
      },
    } as never);

    const result = await datasource.findByWorkflowStateIds([]);

    assert.equal(calls, 0);
    assert.deepEqual(result, []);
  });
});
