import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diaDeNegocio,
  diaLegacy,
  estadoCobro,
  vistaCuotas,
} from "./cuotas-cobro";

const cuota = (
  nroCuota: number,
  fechaCobro: string | null | undefined = null,
  fecha = "2026-10-10",
) => ({
  nroCuota,
  fechaCobro,
  fecha,
  montoTotal: 123,
  saldoCuotaConPunitorios: 25,
  saldoCuota: 20,
  capital: 100,
});
const hoy = "2026-10-10";

describe("Estado individual de cobro", () => {
  for (const [fecha, esperado] of [
    ["2026-09-01", "mes-anterior"],
    ["2026-09-30", "mes-anterior"],
    ["2026-08-31", "vencida"],
    ["2026-10-05", "vencida"],
    ["2026-10-10", "pendiente"],
    ["2026-10-11", "pendiente"],
    ["2027-01-01", "pendiente"],
  ])
    it(`${fecha}: ${esperado}`, () =>
      assert.equal(estadoCobro(cuota(1, null, fecha), hoy), esperado));

  it("el cobro tiene prioridad aun con vencimiento antiguo o inválido", () => {
    for (const fecha of ["2020-01-01", "2026-09-30", "inválida"])
      assert.equal(
        estadoCobro(cuota(1, "2026-10-01T00:00:00", fecha), hoy),
        "cobrada",
      );
  });
  it("enero usa diciembre del año anterior, no treinta días", () => {
    assert.equal(
      estadoCobro(cuota(1, null, "2025-12-01"), "2026-01-31"),
      "mes-anterior",
    );
    assert.equal(
      estadoCobro(cuota(1, null, "2025-12-31"), "2026-01-01"),
      "mes-anterior",
    );
    assert.equal(
      estadoCobro(cuota(1, null, "2025-11-30"), "2026-01-01"),
      "vencida",
    );
  });
  it("usa el día argentino aunque UTC esté en el día y mes siguientes", () => {
    assert.equal(diaDeNegocio(new Date("2026-10-01T02:59:59Z")), "2026-09-30");
    assert.equal(diaDeNegocio(new Date("2026-10-01T03:00:00Z")), "2026-10-01");
    assert.equal(diaLegacy("2026-09-30T00:00:00"), "2026-09-30");
  });
  it("distingue cobros vacíos, ausentes e inválidos sin inventar mora", () => {
    for (const fechaCobro of [null, "", "   "])
      assert.equal(estadoCobro(cuota(1, fechaCobro), hoy), "pendiente");
    for (const fechaCobro of [
      undefined,
      "inválida",
      "2026-02-30",
      "2026-10-10T99:00:00",
    ])
      assert.equal(
        estadoCobro({ ...cuota(1), fechaCobro }, hoy),
        "desconocido",
      );
    for (const fecha of [null, "", "2026-02-29", "2026-13-01", "inválida"])
      assert.equal(estadoCobro({ ...cuota(1), fecha }, hoy), "sin-vencimiento");
    assert.equal(diaLegacy("2024-02-29"), "2024-02-29");
  });
});

describe("Vista compacta del plan", () => {
  const cobradas = Array.from({ length: 7 }, (_, n) => cuota(n, "2026-10-01"));
  it("0 a 6 cobradas: conserva 6 y todas las pendientes", () => {
    const vista = vistaCuotas([...cobradas, cuota(7), cuota(8)], false, hoy);
    assert.equal(vista.cantidadOcultas, 6);
    assert.deepEqual(
      vista.filas.map((f) => f.cuota.nroCuota),
      [6, 7, 8],
    );
    assert.equal(vista.filas[0].ultimaCobrada, true);
  });
  it("solo cuota 0 cobrada: no hay historial oculto", () => {
    const vista = vistaCuotas([cobradas[0], cuota(1)], false, hoy);
    assert.equal(vista.cantidadOcultas, 0);
    assert.deepEqual(
      vista.filas.map((f) => f.cuota.nroCuota),
      [0, 1],
    );
  });
  it("todas cobradas, ninguna cobrada y plan vacío", () => {
    assert.equal(vistaCuotas(cobradas, false, hoy).filas.length, 1);
    assert.equal(vistaCuotas([cuota(0), cuota(1)], false, hoy).filas.length, 2);
    assert.equal(vistaCuotas([], false, hoy).filas.length, 0);
  });
  it("conserva pendientes anteriores y datos desconocidos; ordena por número, no por fecha de cobro", () => {
    const filas = [
      cuota(6, "2026-09-01"),
      cuota(3),
      cuota(2, "2026-10-09"),
      { ...cuota(1), fechaCobro: undefined },
    ];
    assert.deepEqual(
      vistaCuotas(filas, false, hoy).filas.map((f) => f.cuota.nroCuota),
      [1, 3, 6],
    );
  });
  it("expandir restaura cada fila con todos sus datos y contraer restaura la vista", () => {
    const cuotas = [...cobradas].reverse();
    const compacta = vistaCuotas(cuotas, false, hoy);
    assert.deepEqual(
      vistaCuotas(cuotas, true, hoy).filas.map((f) => f.cuota),
      cobradas,
    );
    assert.deepEqual(vistaCuotas(cuotas, false, hoy), compacta);
    assert.equal(cuotas[0].nroCuota, 6);
  });
});
