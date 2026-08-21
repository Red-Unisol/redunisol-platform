/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveCalculadoraSheetZoom,
  resolveInitialCalculadoraSheetName,
} from "./calculadora-riesgo-view-config.ts";

describe("resolveInitialCalculadoraSheetName", () => {
  it("prefers the evaluation sheet when present", () => {
    assert.equal(
      resolveInitialCalculadoraSheetName(["AMEJUCA", "Evaluacion", "CBU"]),
      "Evaluacion",
    );
  });

  it("falls back to the first available sheet", () => {
    assert.equal(
      resolveInitialCalculadoraSheetName(["AMEJUCA", "CBU"]),
      "AMEJUCA",
    );
  });

  it("returns null when there are no sheets", () => {
    assert.equal(resolveInitialCalculadoraSheetName([]), null);
  });
});

describe("resolveCalculadoraSheetZoom", () => {
  it("uses a reduced zoom for the evaluation overview", () => {
    assert.equal(resolveCalculadoraSheetZoom("Evaluacion"), 0.7);
  });

  it("uses calibrated zoom for detail sheets", () => {
    assert.equal(resolveCalculadoraSheetZoom("MUDON"), 0.85);
    assert.equal(resolveCalculadoraSheetZoom("CAJA"), 0.9);
  });

  it("falls back to neutral zoom for unknown sheets", () => {
    assert.equal(resolveCalculadoraSheetZoom("Datos"), 1);
  });
});
