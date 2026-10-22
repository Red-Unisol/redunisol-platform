/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getMontoSuperaTopeError, getTopeMontoRiesgo } from "./tope-monto-riesgo";

const vendedor = {
  isSystemAdmin: false,
  workflowOwner: { code: "VENDEDORES", id: "owner-vendedores", name: "Vendedores" },
};
const preAprobada = {
  estadoActual: { code: "PreAprobada" },
  montoAprobadoRiesgo: 500000,
};

describe("tope-monto-riesgo", () => {
  it("el vendedor tiene tope en PreAprobada y Revisar", () => {
    assert.equal(getTopeMontoRiesgo(vendedor, preAprobada), 500000);
    assert.equal(
      getTopeMontoRiesgo(vendedor, { ...preAprobada, estadoActual: { code: "Revisar" } }),
      500000,
    );
  });

  it("no hay tope en otros estados, sin monto guardado, para Riesgo ni para admin", () => {
    assert.equal(
      getTopeMontoRiesgo(vendedor, { ...preAprobada, estadoActual: { code: "CargaVendedor" } }),
      null,
    );
    assert.equal(getTopeMontoRiesgo(vendedor, { ...preAprobada, montoAprobadoRiesgo: null }), null);
    assert.equal(
      getTopeMontoRiesgo(
        { ...vendedor, workflowOwner: { code: "RIESGO", id: "owner-riesgo", name: "Riesgo" } },
        preAprobada,
      ),
      null,
    );
    assert.equal(getTopeMontoRiesgo({ ...vendedor, isSystemAdmin: true }, preAprobada), null);
  });

  it("solo hay error si el monto pasa el tope", () => {
    assert.equal(getMontoSuperaTopeError(500000, 500000), null);
    assert.equal(getMontoSuperaTopeError(200000, 500000), null);
    assert.equal(getMontoSuperaTopeError(900000, null), null);
    assert.match(getMontoSuperaTopeError(500001, 500000) ?? "", /aprobado por Riesgo \(\$500\.000\)/);
  });
});
