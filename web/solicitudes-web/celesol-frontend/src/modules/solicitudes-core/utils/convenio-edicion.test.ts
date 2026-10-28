import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  toConvenioForm,
  toConvenioRequest,
  type ConvenioSocioValores,
} from "./convenio-edicion.ts";

const original: ConvenioSocioValores = {
  beneficio: "733767/0",
  caja40: 100,
  convAux: null,
  observaciones: "Observacion original",
};

describe("edicion parcial del convenio", () => {
  it("omits the convenio when no values changed or edits were reverted", () => {
    assert.equal(
      toConvenioRequest(toConvenioForm(original), original),
      undefined,
    );
    assert.equal(
      toConvenioRequest(
        {
          ...toConvenioForm(original),
          caja40: "0100",
          beneficio: " 733767/0 ",
        },
        original,
      ),
      undefined,
    );
  });

  it("sends only the edited field and its original value", () => {
    assert.deepEqual(
      toConvenioRequest(
        { ...toConvenioForm(original), caja40: "110" },
        original,
      ),
      {
        caja40: { original: 100, valor: 110 },
      },
    );
  });

  it("keeps text clearing explicit without sending untouched numeric fields", () => {
    assert.deepEqual(
      toConvenioRequest(
        { ...toConvenioForm(original), observaciones: "  " },
        original,
      ),
      {
        observaciones: { original: "Observacion original", valor: null },
      },
    );
  });

  it("distinguishes zero from null in numeric edits", () => {
    assert.deepEqual(
      toConvenioRequest(
        { ...toConvenioForm(original), convAux: "0" },
        original,
      ),
      {
        convAux: { original: null, valor: 0 },
      },
    );
    assert.deepEqual(
      toConvenioRequest({ ...toConvenioForm(original), caja40: "" }, original),
      {
        caja40: { original: 100, valor: null },
      },
    );
  });

  it("normalizes multiple edits without mutating the loaded convenio", () => {
    assert.deepEqual(
      toConvenioRequest(
        { ...toConvenioForm(original), beneficio: " Nuevo ", convAux: "80" },
        original,
      ),
      {
        beneficio: { original: "733767/0", valor: "Nuevo" },
        convAux: { original: null, valor: 80 },
      },
    );
    assert.equal(original.beneficio, "733767/0");
    assert.equal(original.convAux, null);
  });
});
