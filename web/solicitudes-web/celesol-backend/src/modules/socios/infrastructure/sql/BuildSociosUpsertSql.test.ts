import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MappedSocioRow } from "../../application/services/ClassifySocioMutualRow";
import { buildSociosUpsertSql } from "./BuildSociosUpsertSql";

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

describe("buildSociosUpsertSql", () => {
  it("builds an UPSERT statement (ON CONFLICT DO UPDATE) per batch", () => {
    const statements = buildSociosUpsertSql([
      buildMappedRow({ apellido: "O'Brien", cuit: "20409126419" }),
    ]);

    assert.equal(statements.length, 1);
    assert.match(statements[0], /INSERT INTO "socios"/);
    assert.match(statements[0], /gen_random_uuid\(\)/);
    assert.match(statements[0], /'20409126419'/);
    assert.match(statements[0], /O''Brien/);
    assert.match(statements[0], /ON CONFLICT \("cuit"\) DO UPDATE SET/);
  });

  it("updates every Vimax-sourced column via EXCLUDED, and updated_at", () => {
    const statements = buildSociosUpsertSql([buildMappedRow({})]);
    const sql = statements[0];

    for (const column of [
      "tipo_persona",
      "nro_documento",
      "tipo_documento",
      "apellido",
      "nombre",
      "razon_social",
      "sexo",
      "email",
      "celular",
      "nro_socio_legacy",
      "fecha_de_nacimiento",
      "updated_at",
    ]) {
      assert.match(
        sql,
        new RegExp(`"${column}"\\s*=\\s*EXCLUDED\\."${column}"`),
        `expected DO UPDATE SET to include ${column} = EXCLUDED.${column}`,
      );
    }
  });

  it("never touches domicilio_*, id, created_at, or cuit in the DO UPDATE SET clause", () => {
    const statements = buildSociosUpsertSql([buildMappedRow({})]);
    const doUpdateSetClause = statements[0].split("DO UPDATE SET")[1];

    for (const column of [
      "domicilio_calle",
      "domicilio_nro_puerta",
      "domicilio_localidad",
      "domicilio_codigo_postal",
      '"id"',
      "created_at",
      '"cuit" =',
    ]) {
      assert.doesNotMatch(doUpdateSetClause, new RegExp(column));
    }
  });

  it("splits rows across multiple statements when over the batch size", () => {
    const rows = [
      buildMappedRow({ cuit: "1" }),
      buildMappedRow({ cuit: "2" }),
      buildMappedRow({ cuit: "3" }),
    ];

    const statements = buildSociosUpsertSql(rows, 2);

    assert.equal(statements.length, 2);
  });

  it("returns an empty array for no rows", () => {
    assert.deepEqual(buildSociosUpsertSql([]), []);
  });
});
