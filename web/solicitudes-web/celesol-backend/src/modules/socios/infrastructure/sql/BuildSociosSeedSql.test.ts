import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MappedSocioRow } from "../../application/services/ClassifySocioMutualRow";
import {
  buildSociosSeedSql,
  escapeSqlString,
  sqlLiteral,
} from "./BuildSociosSeedSql";

function buildMappedRow(overrides: Partial<MappedSocioRow>): MappedSocioRow {
  return {
    apellido: null,
    celular: null,
    cuit: "20409126419",
    email: null,
    fechaDeNacimiento: null,
    nombre: null,
    nroDocumento: null,
    nroSocioLegacy: null,
    razonSocial: null,
    sexo: null,
    tipoDocumento: null,
    tipoPersona: "FISICA",
    ...overrides,
  };
}

describe("escapeSqlString", () => {
  it("doubles single quotes", () => {
    assert.equal(escapeSqlString("O'Brien"), "O''Brien");
  });
});

describe("sqlLiteral", () => {
  it("returns NULL for null", () => {
    assert.equal(sqlLiteral(null), "NULL");
  });

  it("returns NULL for a blank string", () => {
    assert.equal(sqlLiteral("   "), "NULL");
  });

  it("quotes and escapes a normal string", () => {
    assert.equal(sqlLiteral("O'Brien"), "'O''Brien'");
  });
});

describe("buildSociosSeedSql", () => {
  it("builds a single batched INSERT with a header comment and ON CONFLICT guard", () => {
    const sql = buildSociosSeedSql([
      buildMappedRow({
        apellido: "O'Brien",
        cuit: "20409126419",
        nroSocioLegacy: "1",
        sexo: "Masculino",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }),
      buildMappedRow({
        cuit: "30712345678",
        razonSocial: "Constructora SA",
        tipoPersona: "JURIDICA",
      }),
    ]);

    assert.match(sql, /^-- Auto-generated/);
    assert.match(sql, /INSERT INTO "socios"/);
    assert.match(sql, /gen_random_uuid\(\)/);
    assert.match(sql, /'20409126419'/);
    assert.match(sql, /O''Brien/);
    assert.match(sql, /'JURIDICA'/);
    assert.match(sql, /ON CONFLICT \("cuit"\) DO NOTHING;/);
  });

  it("splits rows across multiple INSERT statements when over the batch size", () => {
    const rows = [
      buildMappedRow({ cuit: "1" }),
      buildMappedRow({ cuit: "2" }),
      buildMappedRow({ cuit: "3" }),
    ];

    const sql = buildSociosSeedSql(rows, 2);

    assert.equal(sql.match(/INSERT INTO "socios"/g)?.length, 2);
  });

  it("returns just the header when there are no rows", () => {
    const sql = buildSociosSeedSql([]);

    assert.doesNotMatch(sql, /INSERT INTO/);
  });
});
