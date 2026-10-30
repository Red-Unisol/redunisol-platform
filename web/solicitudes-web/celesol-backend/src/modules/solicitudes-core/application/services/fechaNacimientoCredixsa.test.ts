import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fechaNacimientoDelInforme } from "./fechaNacimientoCredixsa";

// Datos sinteticos: un informe real es dato personal.
const titular = { cuit: "20123456786", nroDocumento: "12345678" };

describe("fechaNacimientoDelInforme", () => {
  it("takes persona.fecha_nacimiento when the document matches", () => {
    const fecha = fechaNacimientoDelInforme(
      { persona: { documento: "12.345.678", fecha_nacimiento: "31/07/1991" } },
      titular,
    );
    assert.equal(fecha?.toISOString(), "1991-07-31T00:00:00.000Z");
  });

  it("falls back to the date inside persona.edad", () => {
    const fecha = fechaNacimientoDelInforme(
      { persona: { cuit: "20-12345678-6", edad: "35 (31/07/1991)" } },
      titular,
    );
    assert.equal(fecha?.toISOString(), "1991-07-31T00:00:00.000Z");
  });

  it("ignores a report about another person", () => {
    assert.equal(
      fechaNacimientoDelInforme(
        { persona: { documento: "87654321", fecha_nacimiento: "31/07/1991" } },
        titular,
      ),
      null,
    );
  });

  it("ignores invalid or future dates and missing data", () => {
    for (const fecha_nacimiento of ["31/02/1991", "01/01/2999", "sin dato", ""]) {
      assert.equal(
        fechaNacimientoDelInforme(
          { persona: { documento: "12345678", fecha_nacimiento } },
          titular,
        ),
        null,
        fecha_nacimiento,
      );
    }
    assert.equal(fechaNacimientoDelInforme(null, titular), null);
    assert.equal(fechaNacimientoDelInforme({ persona: null }, titular), null);
  });
});
