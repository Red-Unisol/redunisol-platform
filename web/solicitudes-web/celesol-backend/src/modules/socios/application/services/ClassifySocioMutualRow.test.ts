import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SocioMutualPullRow } from "../../infrastructure/services/EvaluateListSociosMutualGateway";
import { classifySocioMutualRow } from "./ClassifySocioMutualRow";

function buildRow(overrides: Partial<SocioMutualPullRow> = {}): SocioMutualPullRow {
  return {
    apellido: null,
    celular: null,
    cuit: null,
    email: null,
    fechaDeNacimiento: null,
    id: null,
    nombre: null,
    nombreCompleto: null,
    nroDoc: null,
    sexo: null,
    tipoDocDescripcion: null,
    ...overrides,
  };
}

function buildCompleteFisicaRow(
  overrides: Partial<SocioMutualPullRow> = {},
): SocioMutualPullRow {
  return buildRow({
    apellido: "Perez",
    celular: "3411234567",
    cuit: "20409126419",
    email: "juan@example.com",
    fechaDeNacimiento: "1985-03-10",
    id: 220844,
    nombre: "Juan",
    nombreCompleto: "Perez Juan",
    nroDoc: "20409126",
    sexo: "1",
    tipoDocDescripcion: "DNI",
    ...overrides,
  });
}

describe("classifySocioMutualRow", () => {
  it("maps a complete persona fisica row (TipoDoc.Descripcion != CUIT)", () => {
    const result = classifySocioMutualRow(buildCompleteFisicaRow());

    assert.deepEqual(result, {
      ok: true,
      row: {
        apellido: "Perez",
        celular: "3411234567",
        cuit: "20409126419",
        email: "juan@example.com",
        fechaDeNacimiento: "1985-03-10",
        nombre: "Juan",
        nroDocumento: "20409126",
        nroSocioLegacy: "220844",
        razonSocial: null,
        sexo: "1",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      },
    });
  });

  it("maps a persona juridica row (TipoDoc.Descripcion == CUIT) using Apellido as razon social", () => {
    const result = classifySocioMutualRow(
      buildRow({
        apellido: "Constructora Ejemplo SA",
        cuit: "30712345678",
        id: 152199,
        nombreCompleto: "Constructora Ejemplo SA",
        nroDoc: "30712345678", // Vimax repite el CUIT en NroDoc para juridica
        sexo: "2",
        tipoDocDescripcion: "CUIT",
      }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.row.tipoPersona, "JURIDICA");
    assert.equal(result.row.razonSocial, "Constructora Ejemplo SA");
    assert.equal(result.row.apellido, null);
    assert.equal(result.row.nombre, null);
    assert.equal(result.row.sexo, null);
    assert.equal(result.row.tipoDocumento, null);
    assert.equal(result.row.fechaDeNacimiento, null);
    assert.equal(
      result.row.nroDocumento,
      null,
      "nro_documento debe quedar NULL para juridica (constraint de la tabla), aunque Vimax mande el CUIT en NroDoc",
    );
  });

  it("falls back to nombreCompleto for razon social when apellido is blank", () => {
    const result = classifySocioMutualRow(
      buildRow({
        apellido: "  ",
        cuit: "30712345679",
        nombreCompleto: "Otra Razon Social SRL",
        tipoDocDescripcion: "CUIT",
      }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.razonSocial, "Otra Razon Social SRL");
  });

  it("skips when cuit is missing", () => {
    const result = classifySocioMutualRow(buildRow({ cuit: null }));
    assert.deepEqual(result, { ok: false, reason: "missing_cuit" });
  });

  it("skips when cuit is blank", () => {
    const result = classifySocioMutualRow(buildRow({ cuit: "   " }));
    assert.deepEqual(result, { ok: false, reason: "missing_cuit" });
  });

  for (const field of [
    "apellido",
    "nombre",
    "nroDoc",
    "tipoDocDescripcion",
    "sexo",
    "fechaDeNacimiento",
  ] as const) {
    it(`skips an incomplete persona fisica row missing ${field}`, () => {
      const result = classifySocioMutualRow(
        buildCompleteFisicaRow({ [field]: null }),
      );
      assert.deepEqual(result, { ok: false, reason: "incomplete_fisica" });
    });
  }

  it("does not require fisica-only fields for juridica rows", () => {
    const result = classifySocioMutualRow(
      buildRow({
        apellido: "Constructora Ejemplo SA",
        cuit: "30712345678",
        tipoDocDescripcion: "CUIT",
      }),
    );

    assert.equal(result.ok, true);
  });

  it("returns null nroSocioLegacy when id is missing", () => {
    const result = classifySocioMutualRow(
      buildCompleteFisicaRow({ id: null }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.nroSocioLegacy, null);
  });
});
