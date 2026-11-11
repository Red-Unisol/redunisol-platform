import assert from "node:assert/strict";
import { it } from "node:test";
import { compareCbu, cbuIdentityChanged } from "./cbu-comparison.ts";

const habitual = "0110000699111100000248";
it("compara CBUs completos sin confundir una ausencia o un valor inválido con coincidencia", () => {
  assert.equal(compareCbu("01100006 99111100000248", habitual), "match");
  assert.equal(compareCbu("0200322911000015391276", habitual), "different");
  assert.equal(compareCbu(null, habitual), "empty");
  assert.equal(compareCbu("", habitual), "empty");
  assert.equal(compareCbu("0110000699111100000249", habitual), "invalid");
  assert.equal(compareCbu("123", "123"), "invalid");
  assert.equal(compareCbu(habitual, "123"), "unverified");
});
it("suspende la comparación al editar la identidad, sin confundir cambios de formato", () => {
  const saved = { nroDocumento: "12.345.678", tipoDocumento: "DNI" };
  assert.equal(
    cbuIdentityChanged(saved, {
      nroDocumento: "12345678",
      tipoDocumento: " dni ",
    }),
    false,
  );
  assert.equal(
    cbuIdentityChanged(saved, { ...saved, nroDocumento: "87654321" }),
    true,
  );
  assert.equal(
    cbuIdentityChanged(saved, { ...saved, tipoDocumento: "LC" }),
    true,
  );
});
