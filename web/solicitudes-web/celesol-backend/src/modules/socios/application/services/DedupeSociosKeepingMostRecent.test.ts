import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MappedSocioRow } from "./ClassifySocioMutualRow";
import { dedupeSociosKeepingMostRecent } from "./DedupeSociosKeepingMostRecent";

function buildRow(overrides: Partial<MappedSocioRow>): MappedSocioRow {
  return {
    apellido: null,
    celular: null,
    cuit: "20409126419",
    email: null,
    fechaDeNacimiento: null,
    nombre: null,
    nroDocumento: null,
    nroSocioLegacy: "1",
    razonSocial: null,
    sexo: null,
    tipoDocumento: null,
    tipoPersona: "FISICA",
    ...overrides,
  };
}

describe("dedupeSociosKeepingMostRecent", () => {
  it("keeps the only row when there are no duplicates", () => {
    const row = buildRow({});
    const result = dedupeSociosKeepingMostRecent([row]);

    assert.deepEqual(result.rows, [row]);
    assert.equal(result.skippedDuplicateCuit, 0);
    assert.equal(result.skippedDuplicateNroDocumento, 0);
  });

  it("keeps the row with the highest nroSocioLegacy when cuit repeats, regardless of input order", () => {
    const older = buildRow({ apellido: "Viejo", nroSocioLegacy: "10" });
    const newer = buildRow({ apellido: "Nuevo", nroSocioLegacy: "50" });

    const resultOlderFirst = dedupeSociosKeepingMostRecent([older, newer]);
    assert.deepEqual(resultOlderFirst.rows, [newer]);
    assert.equal(resultOlderFirst.skippedDuplicateCuit, 1);

    const resultNewerFirst = dedupeSociosKeepingMostRecent([newer, older]);
    assert.deepEqual(resultNewerFirst.rows, [newer]);
    assert.equal(resultNewerFirst.skippedDuplicateCuit, 1);
  });

  it("keeps the row with the highest nroSocioLegacy when nroDocumento repeats across different cuits", () => {
    const older = buildRow({
      cuit: "20409126419",
      nroDocumento: "40912641",
      nroSocioLegacy: "10",
    });
    const newer = buildRow({
      cuit: "20409126420",
      nroDocumento: "40912641",
      nroSocioLegacy: "50",
    });

    const result = dedupeSociosKeepingMostRecent([older, newer]);

    assert.deepEqual(result.rows, [newer]);
    assert.equal(result.skippedDuplicateCuit, 0);
    assert.equal(result.skippedDuplicateNroDocumento, 1);
  });

  it("does not dedupe by nroDocumento when it is null (e.g. juridica rows)", () => {
    const a = buildRow({ cuit: "30712345678", nroDocumento: null, tipoPersona: "JURIDICA" });
    const b = buildRow({ cuit: "30712345679", nroDocumento: null, tipoPersona: "JURIDICA" });

    const result = dedupeSociosKeepingMostRecent([a, b]);

    assert.equal(result.rows.length, 2);
    assert.equal(result.skippedDuplicateNroDocumento, 0);
  });

  it("resolves a chain: cuit duplicate elimination can surface a fresh nroDocumento duplicate", () => {
    // Same cuit, keep id=50 (nroDocumento X). That survivor then collides on
    // nroDocumento X with a separate cuit's id=30 row -- id=50 should still win.
    const a = buildRow({ cuit: "cuitA", nroDocumento: "docX", nroSocioLegacy: "10" });
    const b = buildRow({ cuit: "cuitA", nroDocumento: "docX", nroSocioLegacy: "50" });
    const c = buildRow({ cuit: "cuitB", nroDocumento: "docX", nroSocioLegacy: "30" });

    const result = dedupeSociosKeepingMostRecent([a, b, c]);

    assert.deepEqual(result.rows, [b]);
    assert.equal(result.skippedDuplicateCuit, 1);
    assert.equal(result.skippedDuplicateNroDocumento, 1);
  });

  it("treats a missing nroSocioLegacy as the oldest possible", () => {
    const withoutId = buildRow({ apellido: "SinId", nroSocioLegacy: null });
    const withId = buildRow({ apellido: "ConId", nroSocioLegacy: "1" });

    const result = dedupeSociosKeepingMostRecent([withoutId, withId]);

    assert.deepEqual(result.rows, [withId]);
  });
});
