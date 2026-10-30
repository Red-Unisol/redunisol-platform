import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { esCuitValido } from "./cuit.schema";

describe("esCuitValido", () => {
  // Sinteticos, armados con el algoritmo: un CUIT real es dato personal.
  it("accepts valid CUITs, with or without dashes", () => {
    for (const cuit of ["20123456786", "20-12345678-6", "27 12345678 0", "30123456781"]) {
      assert.equal(esCuitValido(cuit), true, cuit);
    }
  });

  it("rejects a wrong check digit", () => {
    assert.equal(esCuitValido("20123456787"), false);
  });

  it("rejects a length other than 11", () => {
    for (const cuit of ["2012345678", "201234567860", "2035966130520", "1", ""]) {
      assert.equal(esCuitValido(cuit), false, cuit);
    }
  });

  it("rejects letters", () => {
    assert.equal(esCuitValido("20A23456786"), false);
  });
});
