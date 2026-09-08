import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLinkFirmaDigital } from "./buildLinkFirmaDigital";

describe("buildLinkFirmaDigital", () => {
  it("builds the finalizar.php link using the legacyOid as sol", () => {
    assert.equal(
      buildLinkFirmaDigital("555000", "amejuca"),
      "https://redunisol.com.ar/finalizar.php?linea=amejuca&ntrans=0&sol=555000",
    );
  });

  it("omits linea when the linea has no codigo de mutual", () => {
    assert.equal(
      buildLinkFirmaDigital("555000", null),
      "https://redunisol.com.ar/finalizar.php?ntrans=0&sol=555000",
    );
  });

  it("URL-encodes the codigo de mutual", () => {
    assert.equal(
      buildLinkFirmaDigital("555000", "fiat celesol & otros"),
      "https://redunisol.com.ar/finalizar.php?linea=fiat+celesol+%26+otros&ntrans=0&sol=555000",
    );
  });
});
