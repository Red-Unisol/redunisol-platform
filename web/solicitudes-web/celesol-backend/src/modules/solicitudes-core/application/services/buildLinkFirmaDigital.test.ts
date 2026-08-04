import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLinkFirmaDigital } from "./buildLinkFirmaDigital";

describe("buildLinkFirmaDigital", () => {
  it("builds the finalizar.php link using the legacyOid as sol", () => {
    assert.equal(
      buildLinkFirmaDigital("555000", "Personal"),
      "https://redunisol.com.ar/finalizar.php?linea=Personal&ntrans=0&sol=555000",
    );
  });

  it("URL-encodes special characters in lineaPrestamoDescripcion", () => {
    assert.equal(
      buildLinkFirmaDigital("555000", "Comer Recurrente CBU & Otros"),
      "https://redunisol.com.ar/finalizar.php?linea=Comer+Recurrente+CBU+%26+Otros&ntrans=0&sol=555000",
    );
  });
});
