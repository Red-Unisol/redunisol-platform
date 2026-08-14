import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../../../../db/prisma";
import {
  EXPECTED_ACTIVE_WORKFLOW_STATES,
  EXPECTED_ACTIVE_WORKFLOW_TRANSITIONS,
  LEGACY_WORKFLOW_STATE_CODES,
} from "./SolicitudWorkflowCatalog.test-constants";

describe("Canonical workflow transition catalog", () => {
  it("matches the approved canonical state and transition matrix", async () => {
    const states = await prisma.workflowState.findMany({
      where: { isActive: true },
      include: {
        owner: { select: { code: true } },
      },
      orderBy: { code: "asc" },
    });
    const transitions = await prisma.workflowTransition.findMany({
      where: { isActive: true },
      select: {
        actionCode: true,
        defaultComment: true,
        description: true,
        fromState: { select: { code: true } },
        toState: { select: { code: true } },
      },
      orderBy: [
        { fromState: { code: "asc" } },
        { actionCode: "asc" },
      ],
    });

    const keys = transitions.map(
      (transition) =>
        `${transition.fromState.code}|${transition.actionCode}|${transition.toState.code}`,
    );
    const actionKeys = transitions.map(
      (transition) => `${transition.fromState.code}|${transition.actionCode}`,
    );
    const pairKeys = transitions.map(
      (transition) => `${transition.fromState.code}|${transition.toState.code}`,
    );

    assert.deepEqual(
      states.map((state) => `${state.code}|${state.owner.code}`),
      EXPECTED_ACTIVE_WORKFLOW_STATES,
    );
    assert.deepEqual(keys, EXPECTED_ACTIVE_WORKFLOW_TRANSITIONS);
    assert.equal(new Set(keys).size, keys.length, "Duplicate active transition key");
    assert.equal(
      new Set(actionKeys).size,
      actionKeys.length,
      "Duplicate active transition action per source state",
    );
    assert.equal(
      new Set(pairKeys).size,
      pairKeys.length,
      "Duplicate active transition pair",
    );

    for (const transition of transitions) {
      assert.equal(
        typeof transition.defaultComment === "string" ||
          transition.defaultComment === null,
        true,
        `Invalid defaultComment type for ${transition.fromState.code}|${transition.actionCode}`,
      );
      assert.equal(
        typeof transition.description === "string" || transition.description === null,
        true,
        `Invalid description type for ${transition.fromState.code}|${transition.actionCode}`,
      );
    }

    for (const legacyCode of LEGACY_WORKFLOW_STATE_CODES) {
      assert.equal(
        states.some((state) => state.code === legacyCode),
        false,
        `Unexpected active state ${legacyCode}`,
      );
      assert.equal(
        transitions.some(
          (transition) =>
            transition.fromState.code === legacyCode ||
            transition.toState.code === legacyCode,
        ),
        false,
        `Unexpected active transition referencing ${legacyCode}`,
      );
    }

    assert.deepEqual(
      transitions
        .filter((transition) => transition.fromState.code === "Transferir")
        .map((transition) => transition.actionCode),
      ["pagar"],
    );
  });
});
