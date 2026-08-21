import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateSocioJuridicaPatch } from "./ValidateSocioJuridicaPatch";

describe("validateSocioJuridicaPatch", () => {
  it("allows legal entity patch fields", () => {
    assert.doesNotThrow(() =>
      validateSocioJuridicaPatch({
        cuit: "30123456789",
        razonSocial: "ACME SA",
      }),
    );
  });

  it("rejects apellido in persona juridica patch", () => {
    assert.throws(
      () =>
        validateSocioJuridicaPatch({
          apellido: "Perez",
        }),
      /apellido/i,
    );
  });

  it("rejects nombre in persona juridica patch", () => {
    assert.throws(
      () =>
        validateSocioJuridicaPatch({
          nombre: "Juan",
        }),
      /nombre/i,
    );
  });

  it("rejects nroDocumento in persona juridica patch", () => {
    assert.throws(
      () =>
        validateSocioJuridicaPatch({
          nroDocumento: "12345678",
        }),
      /documento/i,
    );
  });

  it("rejects tipoDocumento in persona juridica patch", () => {
    assert.throws(
      () =>
        validateSocioJuridicaPatch({
          tipoDocumento: "DNI",
        }),
      /tipo documento/i,
    );
  });

  it("rejects sexo in persona juridica patch", () => {
    assert.throws(
      () =>
        validateSocioJuridicaPatch({
          sexo: "M",
        }),
      /sexo/i,
    );
  });

  it("rejects fechaDeNacimiento in persona juridica patch", () => {
    assert.throws(
      () =>
        validateSocioJuridicaPatch({
          fechaDeNacimiento: "1990-02-28",
        }),
      /fecha de nacimiento/i,
    );
  });
});
