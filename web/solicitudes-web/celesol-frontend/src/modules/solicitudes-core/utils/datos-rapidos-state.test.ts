import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { socioIndicator, creditosIndicator } from "./datos-rapidos-state";
const ready = { isPending: false, isError: false };
describe("Indicadores de datos rápidos", () => {
  it("distingue carga, no socio y ambigüedad y oculta créditos", () => {
    assert.equal(
      socioIndicator({ ...ready, isPending: true }).text,
      "Consultando condición de socio",
    );
    for (const condicion of ["none", "unknown"]) {
      assert.equal(
        socioIndicator({ ...ready, data: { condicion } }).member,
        false,
      );
    }
    assert.equal(
      socioIndicator({ ...ready, data: { condicion: "none" } }).text,
      "No es socio",
    );
    assert.equal(
      socioIndicator({ ...ready, data: { condicion: "unknown" } }).text,
      "No se pudo verificar",
    );
  });
  it("errores invalidan datos positivos cacheados", () => {
    assert.equal(
      socioIndicator({ ...ready, isError: true, data: { condicion: "member" } })
        .member,
      false,
    );
    assert.equal(
      creditosIndicator({ ...ready, isError: true, data: { activos: false } })
        .text,
      "No se pudo verificar",
    );
  });
  it("créditos distingue true, false, null y carga", () => {
    assert.equal(
      creditosIndicator({ ...ready, data: { activos: true } }).text,
      "Tiene",
    );
    assert.equal(
      creditosIndicator({ ...ready, data: { activos: false } }).text,
      "No tiene",
    );
    assert.equal(
      creditosIndicator({ ...ready, data: { activos: null } }).text,
      "No se pudo verificar",
    );
    assert.equal(
      creditosIndicator({ ...ready, isPending: true }).text,
      "Consultando créditos",
    );
  });
});
