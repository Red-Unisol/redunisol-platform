import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Socio } from "../../domain/entities/Socio.entity";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";
import { InvalidSocioRequestError } from "../../domain/socios-errors";
import { CheckSocioCuitDuplicateUseCase } from "./CheckSocioCuitDuplicate.use-case";

describe("CheckSocioCuitDuplicateUseCase", () => {
  it("returns exists:true when a socio already has that normalized cuit", async () => {
    const repository = buildRepository(buildFisicaSocio());
    const useCase = new CheckSocioCuitDuplicateUseCase({
      repository: repository.repository,
    });

    const result = await useCase.execute({ cuit: " 20-12345678-3 " });

    assert.deepEqual(result, { exists: true });
    assert.deepEqual(repository.findByCuitCalls, [
      { cuit: "20123456783", excludeId: undefined },
    ]);
  });

  it("returns exists:false when no socio has that cuit", async () => {
    const repository = buildRepository(null);
    const useCase = new CheckSocioCuitDuplicateUseCase({
      repository: repository.repository,
    });

    const result = await useCase.execute({ cuit: "20123456783" });

    assert.deepEqual(result, { exists: false });
  });

  it("passes excludeSocioId through so the socio being edited doesn't match itself", async () => {
    const repository = buildRepository(null);
    const useCase = new CheckSocioCuitDuplicateUseCase({
      repository: repository.repository,
    });

    await useCase.execute({ cuit: "20123456783", excludeSocioId: "socio-1" });

    assert.deepEqual(repository.findByCuitCalls, [
      { cuit: "20123456783", excludeId: "socio-1" },
    ]);
  });

  it("rejects a malformed cuit", async () => {
    const repository = buildRepository(null);
    const useCase = new CheckSocioCuitDuplicateUseCase({
      repository: repository.repository,
    });

    await assert.rejects(
      () => useCase.execute({ cuit: "not-a-cuit" }),
      InvalidSocioRequestError,
    );
  });
});

function buildRepository(match: Socio | null) {
  const findByCuitCalls: Array<{ cuit: string; excludeId?: string }> = [];

  return {
    findByCuitCalls,
    repository: {
      create: async () => {
        throw new Error("not used");
      },
      delete: async () => {
        throw new Error("not used");
      },
      findByCuit: async (cuit: string, excludeId?: string) => {
        findByCuitCalls.push({ cuit, excludeId });
        return match;
      },
      findByDocumento: async () => null,
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
