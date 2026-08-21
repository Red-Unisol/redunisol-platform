import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Socio } from "../../domain/entities/Socio.entity";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";
import { LookupSocioByDocumentoUseCase } from "./LookupSocioByDocumento.use-case";

describe("LookupSocioByDocumentoUseCase", () => {
  it("returns a single physical socio match by normalized documento", async () => {
    const repository = buildRepository([buildFisicaSocio()]);
    const useCase = new LookupSocioByDocumentoUseCase({
      repository: repository.repository,
    });

    const result = await useCase.execute({
      documento: " 12.345.678 ",
      tipoDocumento: "dni",
    });

    assert.deepEqual(result, {
      match: "single",
      socio: buildFisicaSocio(),
    });
    assert.deepEqual(repository.lookupCalls, [
      {
        documento: "12345678",
        tipoDocumento: "DNI",
      },
    ]);
  });

  it("returns a single juridica socio match by normalized cuit", async () => {
    const repository = buildRepository([buildJuridicaSocio()]);
    const useCase = new LookupSocioByDocumentoUseCase({
      repository: repository.repository,
    });

    const result = await useCase.execute({
      documento: "30-12345678-9",
    });

    assert.deepEqual(result, {
      match: "single",
      socio: buildJuridicaSocio(),
    });
    assert.deepEqual(repository.lookupCalls, [
      {
        documento: "30123456789",
        tipoDocumento: undefined,
      },
    ]);
  });

  it("returns none when no socio matches", async () => {
    const repository = buildRepository([]);
    const useCase = new LookupSocioByDocumentoUseCase({
      repository: repository.repository,
    });

    const result = await useCase.execute({
      documento: "12345678",
    });

    assert.deepEqual(result, {
      match: "none",
    });
  });

  it("returns multiple when more than one socio matches", async () => {
    const repository = buildRepository([
      buildFisicaSocio(),
      {
        ...buildJuridicaSocio(),
        cuit: "12345678",
      },
    ]);
    const useCase = new LookupSocioByDocumentoUseCase({
      repository: repository.repository,
    });

    const result = await useCase.execute({
      documento: "12345678",
    });

    assert.deepEqual(result, {
      match: "multiple",
    });
  });
});

function buildRepository(matches: Socio[]) {
  const lookupCalls: Array<{
    documento: string;
    tipoDocumento?: string;
  }> = [];

  return {
    lookupCalls,
    repository: {
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
      lookupByDocumento: async (
        documento: string,
        tipoDocumento?: string,
      ) => {
        lookupCalls.push({
          documento,
          tipoDocumento,
        });
        return matches;
      },
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

function buildJuridicaSocio(): Socio {
  return {
    apellido: null,
    celular: "1133344455",
    createdAt: new Date("2026-06-19T18:00:00.000Z"),
    cuit: "30123456789",
    domicilioCalle: null,
    domicilioCodigoPostal: null,
    domicilioLocalidad: null,
    domicilioNroPuerta: null,
    email: "acme@example.com",
    fechaDeNacimiento: null,
    id: "socio-2",
    nombre: null,
    nroDocumento: null,
    nroSocioLegacy: null,
    razonSocial: "ACME SA",
    sexo: null,
    tipoDocumento: null,
    tipoPersona: "JURIDICA",
    updatedAt: new Date("2026-06-19T18:00:00.000Z"),
  };
}
