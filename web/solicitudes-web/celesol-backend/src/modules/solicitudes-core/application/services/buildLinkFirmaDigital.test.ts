import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLinkFirmaDigital } from "./buildLinkFirmaDigital";

const PRODUCCION = "https://redunisol.com.ar/finalizar.php";
const DEV = "https://dev.redunisol.com.ar/finalizar-nvo";

describe("buildLinkFirmaDigital", () => {
  it("builds the link using the legacyOid as sol", () => {
    assert.equal(
      buildLinkFirmaDigital(PRODUCCION, "555000", "amejuca"),
      "https://redunisol.com.ar/finalizar.php?linea=amejuca&ntrans=0&sol=555000",
    );
  });

  it("uses the configured base url", () => {
    assert.equal(
      buildLinkFirmaDigital(DEV, "555000", "amejuca"),
      "https://dev.redunisol.com.ar/finalizar-nvo?linea=amejuca&ntrans=0&sol=555000",
    );
  });

  it("omits linea when the linea has no codigo de mutual", () => {
    assert.equal(
      buildLinkFirmaDigital(PRODUCCION, "555000", null),
      "https://redunisol.com.ar/finalizar.php?ntrans=0&sol=555000",
    );
  });

  it("URL-encodes the codigo de mutual", () => {
    assert.equal(
      buildLinkFirmaDigital(PRODUCCION, "555000", "fiat celesol & otros"),
      "https://redunisol.com.ar/finalizar.php?linea=fiat+celesol+%26+otros&ntrans=0&sol=555000",
    );
  });
});
