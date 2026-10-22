import assert from "node:assert/strict";
import { it } from "node:test";
import { referenciasDeFormula } from "./celdas-de-carga";

it("lee celdas y rangos de la hoja actual y de otras hojas", () => {
  assert.deepEqual(
    referenciasDeFormula("=SUM(D6:D10)+'CRUZ DE EJE'!$H$14-Datos!B2", "CAJA"),
    [
      { hoja: "CAJA", startRow: 5, endRow: 9, startColumn: 3, endColumn: 3 },
      {
        hoja: "CRUZ DE EJE",
        startRow: 13,
        endRow: 13,
        startColumn: 7,
        endColumn: 7,
      },
      { hoja: "Datos", startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 },
    ],
  );
});

it("no toma funciones, textos ni comillas escapadas como referencias", () => {
  assert.deepEqual(referenciasDeFormula('=LOG10(2)&"A1"&ATAN2(1,1)', "X"), []);
  assert.deepEqual(referenciasDeFormula("='Sta Fe''s'!AA1", "X"), [
    {
      hoja: "Sta Fe's",
      startRow: 0,
      endRow: 0,
      startColumn: 26,
      endColumn: 26,
    },
  ]);
});
