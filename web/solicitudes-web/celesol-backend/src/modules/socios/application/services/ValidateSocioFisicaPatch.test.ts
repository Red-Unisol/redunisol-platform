import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateSocioFisicaPatch } from "./ValidateSocioFisicaPatch";

describe("validateSocioFisicaPatch", () => {
  it("allows physical patch fields", () => {
    assert.doesNotThrow(() =>
      validateSocioFisicaPatch({
        apellido: "Perez",
        cuit: "20123456783",
      }),
    );
  });

  it("rejects razonSocial in persona fisica patch", () => {
    assert.throws(
      () =>
        validateSocioFisicaPatch({
          razonSocial: "No corresponde",
        }),
      /razon social/i,
    );
  });
});
