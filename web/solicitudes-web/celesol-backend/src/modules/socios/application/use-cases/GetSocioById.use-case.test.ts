import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SocioNotFoundError } from "../../domain/socios-errors";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";
import type { Socio } from "../../domain/entities/Socio.entity";
import { GetSocioByIdUseCase } from "./GetSocioById.use-case";

function buildSocio(): Socio {
  return {
    apellido: "Perez",
    celular: null,
    createdAt: new Date(),
    cuit: "20123456783",
    domicilioCalle: null,
    domicilioCodigoPostal: null,
    domicilioLocalidad: null,
    domicilioNroPuerta: null,
    email: null,
    fechaDeNacimiento: new Date("1990-02-28T00:00:00.000Z"),
    id: "socio-1",
    nombre: "Juan",
    nroDocumento: "12345678",
    nroSocioLegacy: null,
    razonSocial: null,
    sexo: "M",
    tipoDocumento: "DNI",
    tipoPersona: "FISICA",
    updatedAt: new Date(),
  };
}

describe("GetSocioByIdUseCase", () => {
  it("returns the socio by id", async () => {
    const repository: SocioRepository = {
      create: async () => {
        throw new Error("not used");
      },
      delete: async () => {
        throw new Error("not used");
      },
      findByCuit: async () => null,
      findByDocumento: async () => null,
      findById: async () => buildSocio(),
      list: async () => [],
      lookupByDocumento: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new GetSocioByIdUseCase({ repository });

    const socio = await useCase.execute({ id: "socio-1" });

    assert.equal(socio.id, "socio-1");
  });

  it("throws not found when the socio does not exist", async () => {
    const repository: SocioRepository = {
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
      lookupByDocumento: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new GetSocioByIdUseCase({ repository });

    await assert.rejects(() => useCase.execute({ id: "missing" }), SocioNotFoundError);
  });
});
