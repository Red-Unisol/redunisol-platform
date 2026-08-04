import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SocioCuitDuplicateError,
  SocioDocumentoDuplicateError,
  SocioNotFoundError,
} from "../../domain/socios-errors";
import type { Socio } from "../../domain/entities/Socio.entity";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";
import { UpdateSocioUseCase } from "./UpdateSocio.use-case";

class InMemorySocioRepository implements SocioRepository {
  socios: Socio[];

  constructor(socios: Socio[]) {
    this.socios = socios;
  }

  async create(
    _input: Parameters<SocioRepository["create"]>[0],
  ): Promise<Socio> {
    throw new Error("not used");
  }

  async delete() {
    throw new Error("not used");
  }

  async findByCuit(cuit: string, excludeId?: string) {
    return (
      this.socios.find(
        (candidate) => candidate.cuit === cuit && candidate.id !== excludeId,
      ) ?? null
    );
  }

  async findByDocumento(nroDocumento: string, excludeId?: string) {
    return (
      this.socios.find(
        (candidate) =>
          candidate.nroDocumento === nroDocumento && candidate.id !== excludeId,
      ) ?? null
    );
  }

  async findById(id: string) {
    return this.socios.find((candidate) => candidate.id === id) ?? null;
  }

  async list() {
    return this.socios;
  }

  async lookupByDocumento(documento: string, tipoDocumento?: string) {
    return this.socios.filter((candidate) => {
      if (
        candidate.tipoPersona === "FISICA" &&
        candidate.nroDocumento === documento
      ) {
        return !tipoDocumento || candidate.tipoDocumento === tipoDocumento;
      }

      return candidate.tipoPersona === "JURIDICA" && candidate.cuit === documento;
    });
  }

  async update(id: string, input: Parameters<SocioRepository["update"]>[1]) {
    const socio = this.socios.find((candidate) => candidate.id === id);

    if (!socio) {
      throw new SocioNotFoundError();
    }

    if (socio.tipoPersona === "FISICA" && input.tipoPersona === "FISICA") {
      Object.assign(socio, input);
      return socio;
    }

    if (socio.tipoPersona === "JURIDICA" && input.tipoPersona === "JURIDICA") {
      Object.assign(socio, input);
      return socio;
    }

    throw new Error("unexpected");
  }
}

function buildFisica(overrides: Partial<Socio> = {}): Socio {
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
    ...overrides,
  } as Socio;
}

describe("UpdateSocioUseCase", () => {
  it("updates a persona fisica keeping its own normalized cuit and document", async () => {
    const repository = new InMemorySocioRepository([buildFisica()]);
    const useCase = new UpdateSocioUseCase({ repository });

    const socio = await useCase.execute({
      body: {
        cuit: "20.12345678-3",
        nroDocumento: "12.345.678",
      },
      id: "socio-1",
    });

    assert.equal(socio.cuit, "20123456783");
    assert.equal(socio.nroDocumento, "12345678");
  });

  it("updates domicilio fields for persona fisica", async () => {
    const repository = new InMemorySocioRepository([buildFisica()]);
    const useCase = new UpdateSocioUseCase({ repository });

    const socio = await useCase.execute({
      body: {
        domicilioCalle: "Belgrano",
        domicilioCodigoPostal: "3000",
        domicilioLocalidad: "5",
        domicilioNroPuerta: "100",
      },
      id: "socio-1",
    });

    assert.equal(socio.tipoPersona === "FISICA" && socio.domicilioCalle, "Belgrano");
    assert.equal(
      socio.tipoPersona === "FISICA" && socio.domicilioNroPuerta,
      "100",
    );
    assert.equal(
      socio.tipoPersona === "FISICA" && socio.domicilioLocalidad,
      "5",
    );
    assert.equal(
      socio.tipoPersona === "FISICA" && socio.domicilioCodigoPostal,
      "3000",
    );
  });

  it("rejects duplicate cuit excluding the current socio", async () => {
    const repository = new InMemorySocioRepository([
      buildFisica(),
      buildFisica({ cuit: "20987654321", id: "socio-2", nroDocumento: "87654321" }),
    ]);
    const useCase = new UpdateSocioUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          body: {
            cuit: "20-98765432-1",
          },
          id: "socio-1",
        }),
      SocioCuitDuplicateError,
    );
  });

  it("rejects duplicate document excluding the current socio", async () => {
    const repository = new InMemorySocioRepository([
      buildFisica(),
      buildFisica({ cuit: "20987654321", id: "socio-2", nroDocumento: "AB12345C" }),
    ]);
    const useCase = new UpdateSocioUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          body: {
            nroDocumento: "ab-12.345 c",
          },
          id: "socio-1",
        }),
      SocioDocumentoDuplicateError,
    );
  });

  it("throws not found when patching a missing socio", async () => {
    const repository = new InMemorySocioRepository([]);
    const useCase = new UpdateSocioUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          body: {
            celular: "11 4444 5555",
          },
          id: "missing",
        }),
      SocioNotFoundError,
    );
  });

  it("rejects legal-incompatible physical fields in persona juridica patch", async () => {
    const repository = new InMemorySocioRepository([
      {
        apellido: null,
        celular: null,
        createdAt: new Date(),
        cuit: "30123456789",
        domicilioCalle: null,
        domicilioCodigoPostal: null,
        domicilioLocalidad: null,
        domicilioNroPuerta: null,
        email: null,
        fechaDeNacimiento: null,
        id: "socio-1",
        nombre: null,
        nroDocumento: null,
        nroSocioLegacy: null,
        razonSocial: "ACME SA",
        sexo: null,
        tipoDocumento: null,
        tipoPersona: "JURIDICA",
        updatedAt: new Date(),
      },
    ]);
    const useCase = new UpdateSocioUseCase({ repository });

    await assert.rejects(
      () =>
        useCase.execute({
          body: {
            nroDocumento: "12345678",
          },
          id: "socio-1",
        }),
      /documento/i,
    );
  });
});
