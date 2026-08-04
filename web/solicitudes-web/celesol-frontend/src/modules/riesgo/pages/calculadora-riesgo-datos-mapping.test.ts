/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CalculadoraMutualDatos } from "../services/riesgo-api";
import { buildCalculadoraDatosCellWrites } from "./calculadora-riesgo-datos-mapping.ts";

function buildDatos(
  overrides: Partial<CalculadoraMutualDatos> = {},
): CalculadoraMutualDatos {
  return {
    antiguedadLaboral: 36,
    compromisoMensualVigente: 20000,
    convenio: "AMEJUCA",
    cuitTitular: "27204091264",
    cuotaResultante: 18500.5,
    cuotas: 6,
    cupoDisponibleVendedor: 300000,
    dniTitular: "20409126",
    fechaPrimerVencimiento: "2026-07-10",
    fechaSolicitud: "2026-06-01",
    ingresos: 850000,
    lineaDescripcion: "AMEJUCA ESPECIAL",
    lineaId: 2519,
    montoAFinanciar: 100000,
    nombreCompletoTitular: "ADA LOVELACE",
    nroSolicitud: "1000001",
    rechazosDelMes: 0,
    saldoPrestamosVigentes: 30000,
    situacionSocio: "Al dia",
    titularNuevo: false,
    vendedor: "hpajon",
    ...overrides,
  };
}

describe("buildCalculadoraDatosCellWrites", () => {
  it("maps every resolved field to its Datos sheet cell", () => {
    const writes = buildCalculadoraDatosCellWrites(buildDatos());
    const byCell = Object.fromEntries(
      writes.map(({ cell, value }) => [cell, value]),
    );

    assert.equal(byCell.B2, "1000001");
    assert.equal(byCell.B3, "AMEJUCA ESPECIAL");
    assert.equal(byCell.B4, 2519);
    assert.equal(byCell.B5, 100000);
    assert.equal(byCell.B6, 6);
    assert.equal(byCell.B7, 18500.5);
    assert.equal(byCell.B9, "hpajon");
    assert.equal(byCell.B10, "AMEJUCA");
    assert.equal(byCell.B11, "2026-06-01");
    assert.equal(byCell.B12, "2026-07-10");
    assert.equal(byCell.B14, "20409126");
    assert.equal(byCell.B15, "27204091264");
    assert.equal(byCell.B16, "ADA LOVELACE");
    assert.equal(byCell.B26, 850000);
    assert.equal(byCell.B27, 36);
    assert.equal(byCell.D13, false);
    assert.equal(byCell.D18, 300000);
    assert.equal(byCell.D19, 30000);
    assert.equal(byCell.D20, 20000);
    assert.equal(byCell.D22, "Al dia");
    assert.equal(byCell.D23, 0);
  });

  it("never writes cells for the fields excluded from integration", () => {
    const writes = buildCalculadoraDatosCellWrites(buildDatos());
    const cells = writes.map((write) => write.cell);

    // TEM (B8), Cupo Interno (D17), Registro de Quiebras (D21),
    // Riesgo BCRA (F24) y Peor Situacion 24m (E25) quedan fuera a propósito.
    assert.ok(!cells.includes("B8"));
    assert.ok(!cells.includes("D17"));
    assert.ok(!cells.includes("D21"));
    assert.ok(!cells.includes("F24"));
    assert.ok(!cells.includes("E25"));
  });

  it("skips a cell when its value is null instead of writing a falsy placeholder", () => {
    const writes = buildCalculadoraDatosCellWrites(
      buildDatos({
        rechazosDelMes: null,
        situacionSocio: null,
        titularNuevo: null,
      }),
    );
    const cells = writes.map((write) => write.cell);

    assert.ok(!cells.includes("D13"));
    assert.ok(!cells.includes("D22"));
    assert.ok(!cells.includes("D23"));
  });

  it("keeps a falsy-but-present value like rechazos = 0", () => {
    const writes = buildCalculadoraDatosCellWrites(
      buildDatos({ rechazosDelMes: 0 }),
    );
    const d23 = writes.find((write) => write.cell === "D23");

    assert.equal(d23?.value, 0);
  });
});
