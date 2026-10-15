import assert from "node:assert/strict";
import { it } from "node:test";
import { numeroArgentino, tablaNumerosArgentinos } from "./numero-argentino";

it("convierte los cuatro importes indicados y variantes de signo y moneda", () => {
  for (const [text, value] of [
    ["2.046.287,77", 2046287.77],
    ["12.100,00", 12100],
    ["140.234,8", 140234.8],
    ["4.457,80", 4457.8],
    [" -12.100,00 ", -12100],
    ["$ 4.457,80", 4457.8],
    ["ARS 12.100,00", 12100],
    ["0,00", 0],
    ["1.000", 1000],
    ["0,8", 0.8],
  ] as const)
    assert.equal(numeroArgentino(text), value);
});
it("no interpreta textos, fechas, formulas, porcentajes, códigos ni formatos inválidos como importes argentinos", () => {
  for (const text of [
    "Cliente",
    "13.10.2026",
    "13/10/2026",
    "=SUM(A1:A2)",
    "30,5%",
    "'12.100,00",
    "000123,45",
    "12.10,00",
    "1.23.456,00",
    "1,234.56",
    "12100",
    "1.2",
    "9007199254740993,00",
    "2.046.287,77\n12.100,00",
  ])
    assert.equal(numeroArgentino(text), null, text);
  assert.equal(numeroArgentino(null), null);
  assert.equal(numeroArgentino(123), null);
});

it("listas de importes generan filas y columnas, pero no cambian párrafos de texto", () => {
  assert.equal(
    tablaNumerosArgentinos("12.100,00\n4.457,80"),
    "<table><tr><td>12.100,00</td></tr><tr><td>4.457,80</td></tr></table>",
  );
  assert.equal(
    tablaNumerosArgentinos("12.100,00\t4.457,80"),
    "<table><tr><td>12.100,00</td><td>4.457,80</td></tr></table>",
  );
  assert.equal(tablaNumerosArgentinos("Cliente\n12.100,00"), null);
  assert.equal(tablaNumerosArgentinos("12.100,00"), null);
});
