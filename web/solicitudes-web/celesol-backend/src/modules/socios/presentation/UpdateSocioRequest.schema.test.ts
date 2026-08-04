import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  socioIdParamsSchema,
  updateSocioBodySchema,
} from "./UpdateSocioRequest.schema";

describe("updateSocioRequest schemas", () => {
  it("accepts a valid uuid param", () => {
    const parsed = socioIdParamsSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
    });

    assert.deepEqual(parsed, {
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("rejects an invalid uuid param", () => {
    assert.equal(
      socioIdParamsSchema.safeParse({
        id: "not-a-uuid",
      }).success,
      false,
    );
  });

  it("accepts a non-empty patch body with allowed fields", () => {
    const parsed = updateSocioBodySchema.parse({
      celular: " 11 4444 5555 ",
      cuit: " 20-12345678-3 ",
    });

    assert.deepEqual(parsed, {
      celular: "11 4444 5555",
      cuit: "20-12345678-3",
    });
  });

  it("accepts and trims domicilio fields in patch", () => {
    const parsed = updateSocioBodySchema.parse({
      domicilioCalle: " Belgrano ",
      domicilioCodigoPostal: " 3000 ",
      domicilioLocalidad: " 5 ",
      domicilioNroPuerta: " 100 ",
    });

    assert.deepEqual(parsed, {
      domicilioCalle: "Belgrano",
      domicilioCodigoPostal: "3000",
      domicilioLocalidad: "5",
      domicilioNroPuerta: "100",
    });
  });

  it("rejects an empty patch body", () => {
    assert.equal(updateSocioBodySchema.safeParse({}).success, false);
  });

  it("rejects tipoPersona in patch", () => {
    assert.equal(
      updateSocioBodySchema.safeParse({
        tipoPersona: "JURIDICA",
      }).success,
      false,
    );
  });

  it("rejects nroSocioLegacy in patch", () => {
    assert.equal(
      updateSocioBodySchema.safeParse({
        nroSocioLegacy: "LEG-1",
      }).success,
      false,
    );
  });

  it("rejects unknown fields in patch", () => {
    assert.equal(
      updateSocioBodySchema.safeParse({
        cualquierOtroCampo: "valor",
      }).success,
      false,
    );
  });
});
