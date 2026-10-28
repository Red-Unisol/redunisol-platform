import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hoyEnArgentina,
  planCobroRefinanciacion,
} from "./PlanCobroRefinanciacion";

const CUOTAS = [
  { fecha: "2026-08-31T00:00:00", nroCuota: 21 },
  { fecha: "2026-09-30T00:00:00", nroCuota: 22 },
  { fecha: "2026-10-28T00:00:00", nroCuota: 23 },
  { fecha: "2026-11-30T00:00:00", nroCuota: 24 },
  { fecha: null, nroCuota: 25 },
];

describe("planCobroRefinanciacion", () => {
  it("charges overdue cuotas apart, in order, and the rest out of order", () => {
    assert.deepEqual(planCobroRefinanciacion([24, 22, 21, 23], CUOTAS, "2026-10-28"), [
      { nrosCuota: [21, 22], permitePagoFueraDeOrden: false },
      // Vence hoy: todavia no esta vencida.
      { nrosCuota: [23, 24], permitePagoFueraDeOrden: true },
    ]);
  });

  it("makes a single cobro when there is nothing overdue", () => {
    assert.deepEqual(planCobroRefinanciacion([24], CUOTAS, "2026-10-28"), [
      { nrosCuota: [24], permitePagoFueraDeOrden: true },
    ]);
  });

  it("makes a single cobro when everything is overdue", () => {
    assert.deepEqual(planCobroRefinanciacion([22, 21], CUOTAS, "2026-10-28"), [
      { nrosCuota: [21, 22], permitePagoFueraDeOrden: false },
    ]);
  });

  it("does not treat a cuota without a known date as overdue", () => {
    assert.deepEqual(planCobroRefinanciacion([25, 99], CUOTAS, "2026-10-28"), [
      { nrosCuota: [25, 99], permitePagoFueraDeOrden: true },
    ]);
  });
});

describe("hoyEnArgentina", () => {
  it("uses the Argentina date, not UTC", () => {
    // 28/10 a las 22 en Argentina ya es 29/10 en UTC.
    assert.equal(hoyEnArgentina(new Date("2026-10-29T01:00:00Z")), "2026-10-28");
  });
});
