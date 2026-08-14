import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Socio } from "../../domain/entities/Socio.entity";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";
import { CheckSocioDocumentoDuplicateUseCase } from "./CheckSocioDocumentoDuplicate.use-case";

describe("CheckSocioDocumentoDuplicateUseCase", () => {
  it("returns exists:true when a socio already has that normalized documento", async () => {
    const repository = buildRepository(buildFisicaSocio());
    const useCase = new CheckSocioDocumentoDuplicateUseCase({
      repository: repository.repository,
    });

    const result = await useCase.execute({ nroDocumento: " 12.345.678 " });

    assert.deepEqual(result, { exists: true });
    assert.deepEqual(repository.findByDocumentoCalls, [
      { excludeId: undefined, nroDocumento: "12345678" },
    ]);
  });

  it("returns exists:false when no socio has that documento", async () => {
    const repository = buildRepository(null);
    const useCase = new CheckSocioDocumentoDuplicateUseCase({
      repository: repository.repository,
    });

    const result = await useCase.execute({ nroDocumento: "12345678" });

    assert.deepEqual(result, { exists: false });
  });

  it("passes excludeSocioId through so the socio being edited doesn't match itself", async () => {
    const repository = buildRepository(null);
    const useCase = new CheckSocioDocumentoDuplicateUseCase({
      repository: repository.repository,
    });

    await useCase.execute({
      excludeSocioId: "socio-1",
      nroDocumento: "12345678",
    });

    assert.deepEqual(repository.findByDocumentoCalls, [
      { excludeId: "socio-1", nroDocumento: "12345678" },
    ]);
  });
});

function buildRepository(match: Socio | null) {
  const findByDocumentoCalls: Array<{
    excludeId?: string;
    nroDocumento: string;
  }> = [];

  return {
    findByDocumentoCalls,
    repository: {
      create: async () => {
        throw new Error("not used");
      },
      delete: async () => {
        throw new Error("not used");
      },
      findByCuit: async () => null,
      findByDocumento: async (nroDocumento: string, excludeId?: string) => {
        findByDocumentoCalls.push({ excludeId, nroDocumento });
        return match;
      },
      findById: async () => null,
      list: async () => [],
      lookupByDocumento: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    } satisfies SocioRepository,
  };
}

function buildFisicaSocio(): Socio {
  return {
    apellido: "Perez",
    celular: "1133344455",
    createdAt: new Date("2026-06-19T18:00:00.000Z"),
    cuit: "20123456783",
    domicilioCalle: null,
    domicilioCodigoPostal: null,
    domicilioLocalidad: null,
    domicilioNroPuerta: null,
    email: "juan@example.com",
    fechaDeNacimiento: new Date("1990-02-28T00:00:00.000Z"),
    id: "socio-1",
    nombre: "Juan",
    nroDocumento: "12345678",
    nroSocioLegacy: null,
    razonSocial: null,
    sexo: "Masculino",
    tipoDocumento: "DNI",
    tipoPersona: "FISICA",
    updatedAt: new Date("2026-06-19T18:00:00.000Z"),
  };
}
