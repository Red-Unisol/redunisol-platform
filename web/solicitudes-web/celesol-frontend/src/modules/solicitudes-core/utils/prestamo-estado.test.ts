import assert from "node:assert/strict";
import { it } from "node:test";
import { clasificarEstadoPrestamo } from "./prestamo-estado";
it("130338 es activo por Estado=0 aunque Vigente sea falso", () => {
  const prestamo = { estado: 0, vigente: false };
  assert.equal(clasificarEstadoPrestamo(prestamo), "activos");
});
it("otros códigos no se etiquetan como pagados y datos ausentes no son activos", () => {
  assert.equal(clasificarEstadoPrestamo({ estado: 1 }), "otros");
  for (const estado of [null, undefined, NaN, Infinity, 0.5])
    assert.equal(clasificarEstadoPrestamo({ estado }), "desconocidos");
});
