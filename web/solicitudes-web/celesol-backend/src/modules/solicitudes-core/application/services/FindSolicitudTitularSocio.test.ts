import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Socio } from "../../../socios/domain/entities/Socio.entity";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import { FindSolicitudTitularSocio } from "./FindSolicitudTitularSocio";

describe("FindSolicitudTitularSocio", () => {
  it("returns the socio matched by normalized documento and tipoDocumento", async () => {
    const calls: Array<{ documento: string; tipoDocumento?: string }> = [];
    const service = new FindSolicitudTitularSocio({
      sociosRepository: socioRepository({
        lookupByDocumento: async (documento, tipoDocumento) => {
          calls.push({ documento, tipoDocumento });
          return [buildSocio()];
        },
      }),
    });

    const result = await service.execute({
      cuit: "20-33344455-9",
      nroDocumento: "33.344.455",
      tipoDocumento: "dni",
    });

    assert.deepEqual(result, buildSocio());
    assert.deepEqual(calls, [
      { documento: "33344455", tipoDocumento: "DNI" },
    ]);
  });

  it("falls back to cuit when documento does not match", async () => {
    const calls: Array<{ documento: string; tipoDocumento?: string }> = [];
    const service = new FindSolicitudTitularSocio({
      sociosRepository: socioRepository({
        lookupByDocumento: async (documento, tipoDocumento) => {
          calls.push({ documento, tipoDocumento });
          return documento === "20333444559" ? [buildSocio()] : [];
        },
      }),
    });

    const result = await service.execute({
      cuit: "20-33344455-9",
      nroDocumento: "33344455",
      tipoDocumento: "DNI",
    });

    assert.deepEqual(result, buildSocio());
    assert.deepEqual(calls, [
      { documento: "33344455", tipoDocumento: "DNI" },
      { documento: "20333444559", tipoDocumento: undefined },
    ]);
  });

  it("returns null when nothing matches by documento or cuit", async () => {
    const service = new FindSolicitudTitularSocio({
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
    });

    const result = await service.execute({
      cuit: "20-33344455-9",
      nroDocumento: "33344455",
      tipoDocumento: "DNI",
    });

    assert.equal(result, null);
  });

  it("returns null when the titular has neither documento nor a valid cuit", async () => {
    const service = new FindSolicitudTitularSocio({
      sociosRepository: socioRepository(),
    });

    const result = await service.execute({
      cuit: null,
      nroDocumento: null,
      tipoDocumento: null,
    });

    assert.equal(result, null);
  });
});

function buildSocio(): Socio {
  return {
    apellido: "Perez",
    celular: null,
    createdAt: new Date("2026-06-19T18:00:00.000Z"),
    cuit: "20333444559",
    domicilioCalle: null,
    domicilioCodigoPostal: null,
    domicilioLocalidad: null,
    domicilioNroPuerta: null,
    email: null,
    fechaDeNacimiento: new Date("1990-01-01T00:00:00.000Z"),
    id: "socio-1",
    nombre: "Juan",
    nroDocumento: "33344455",
    nroSocioLegacy: "143471",
    razonSocial: null,
    sexo: "M",
    tipoDocumento: "DNI",
    tipoPersona: "FISICA",
    updatedAt: new Date("2026-06-19T18:00:00.000Z"),
  };
}

function socioRepository(
  overrides: Partial<SocioRepository> = {},
): SocioRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    delete: async () => {
      throw new Error("not used");
    },
    findByCuit: async () => null,
    findByDocumento: async () => null,
    findById: async () => null,
    list: async () => [],
    lookupByDocumento: async () => [buildSocio()],
    update: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}
