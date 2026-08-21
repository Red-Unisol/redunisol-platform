/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDashboardPanelToneStyles } from "./dashboard-panel-styles.ts";

describe("getDashboardPanelToneStyles", () => {
  it("returns warning border for warning panels", () => {
    assert.deepEqual(getDashboardPanelToneStyles("warning"), {
      border: "#FDE68A",
    });
  });

  it("returns danger border for danger panels", () => {
    assert.deepEqual(getDashboardPanelToneStyles("danger"), {
      border: "#FECACA",
    });
  });

  it("returns neutral border for neutral panels", () => {
    assert.deepEqual(getDashboardPanelToneStyles("neutral"), {
      border: "#e0e0e0",
    });
  });
});
