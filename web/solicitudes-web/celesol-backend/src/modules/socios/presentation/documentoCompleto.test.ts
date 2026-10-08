import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { documentoCompleto } from "./SociosController";

describe("documentoCompleto", () => {
  it("acepta DNI de 7 u 8 digitos y CUIL/CUIT de 11, con o sin separadores", () => {
    assert.equal(documentoCompleto("1234567"), "1234567");
    assert.equal(documentoCompleto("30.123.456"), "30123456");
    assert.equal(documentoCompleto("20-30123456-7"), "20301234567");
    assert.equal(documentoCompleto(" 20301234567 "), "20301234567");
  });

  it("rechaza parciales, nombres y largos que no son documento", () => {
    for (const valor of [undefined, "", "1234", "123456789", "Garcia", "3012345a"]) {
      assert.equal(documentoCompleto(valor), null);
    }
  });
});
