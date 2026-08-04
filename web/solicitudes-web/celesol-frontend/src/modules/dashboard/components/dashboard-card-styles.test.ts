/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getDashboardCardToneStyles,
  getDashboardMetricCardToneStyles,
  getDashboardPillToneStyles,
} from "./dashboard-card-styles.ts";

describe("getDashboardCardToneStyles", () => {
  it("returns warning colors for warning cards", () => {
    assert.deepEqual(getDashboardCardToneStyles("warning"), {
      background: "#FFF7ED",
      border: "#FED7AA",
      number: "#C2410C",
      text: "#9A3412",
    });
  });

  it("returns neutral colors for neutral cards", () => {
    assert.deepEqual(getDashboardCardToneStyles("neutral"), {
      background: "#F9FAFB",
      border: "#E5E7EB",
      number: "#374151",
      text: "#6B7280",
    });
  });
});

describe("getDashboardPillToneStyles", () => {
  it("returns danger colors for danger pills", () => {
    assert.deepEqual(getDashboardPillToneStyles("danger"), {
      background: "#FEF2F2",
      text: "#DC2626",
    });
  });

  it("returns soft warning colors for warning pills", () => {
    assert.deepEqual(getDashboardPillToneStyles("warning"), {
      background: "#FFFBEB",
      text: "#D97706",
    });
  });
});

describe("getDashboardMetricCardToneStyles", () => {
  it("returns uppercase label and value colors for warning metric cards", () => {
    assert.deepEqual(getDashboardMetricCardToneStyles("warning"), {
      background: "#FFF7ED",
      border: "#FED7AA",
      label: "#9A3412",
      value: "#C2410C",
    });
  });

  it("returns uppercase label and value colors for danger metric cards", () => {
    assert.deepEqual(getDashboardMetricCardToneStyles("danger"), {
      background: "#FEF2F2",
      border: "#FECACA",
      label: "#991B1B",
      value: "#DC2626",
    });
  });
});
