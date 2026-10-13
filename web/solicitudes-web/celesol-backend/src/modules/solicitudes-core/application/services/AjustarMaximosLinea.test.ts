import assert from "node:assert/strict";
import { it } from "node:test";
import { ajustarMaximosLinea } from "./AjustarMaximosLinea";
import { ConfiguracionMaximosLineaInvalidaError } from "../../domain/solicitudes-core-errors";
const linea = {
  descripcion: "Prueba",
  legacyOid: "1",
  vigente: true,
  montoMaximo: 10000,
  cantidadMaximaCuotas: 12,
};
it("clamps only excesses and leaves smaller/equal/missing values unchanged", () => {
  assert.deepEqual(
    ajustarMaximosLinea(linea, { montoAFinanciar: 20000, cuotas: 48 }),
    { montoAFinanciar: 10000, cuotas: 12 },
  );
  for (const values of [
    { montoAFinanciar: 10000, cuotas: 12 },
    { montoAFinanciar: 5000, cuotas: 6 },
    { montoAFinanciar: null, cuotas: null },
  ])
    assert.deepEqual(ajustarMaximosLinea(linea, values), values);
});
it("rejects absent, zero or inconsistent maxima instead of interpreting them as no limit", () => {
  for (const limits of [
    { montoMaximo: null },
    { montoMaximo: 0 },
    { cantidadMaximaCuotas: 0 },
    { cantidadMaximaCuotas: 1.5 },
    { montoMinimo: 20000 },
    { cantidadMinimaCuotas: 13 },
  ])
    assert.throws(
      () =>
        ajustarMaximosLinea(
          { ...linea, ...limits },
          { montoAFinanciar: 20000, cuotas: 48 },
        ),
      ConfiguracionMaximosLineaInvalidaError,
    );
});
