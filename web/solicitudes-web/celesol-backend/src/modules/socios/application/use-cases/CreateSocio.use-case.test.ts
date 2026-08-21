import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SocioCuitDuplicateError, SocioDocumentoDuplicateError } from "../../domain/socios-errors";
import type { SocioRepository } from "../../domain/repositories/SocioRepository";
import type { Socio } from "../../domain/entities/Socio.entity";
import type { CrearSocioMutualGateway } from "../../infrastructure/services/CrearSocioMutualGateway";
import { CreateSocioUseCase } from "./CreateSocio.use-case";

class InMemorySocioRepository implements SocioRepository {
  socios: Socio[] = [];

  async create(input: Parameters<SocioRepository["create"]>[0]) {
    const socio: Socio =
      input.tipoPersona === "FISICA"
        ? {
            apellido: input.apellido,
            celular: input.celular ?? null,
            createdAt: new Date("2026-06-19T18:00:00.000Z"),
            cuit: input.cuit,
            domicilioCalle: input.domicilioCalle,
            domicilioCodigoPostal: input.domicilioCodigoPostal,
            domicilioLocalidad: input.domicilioLocalidad,
            domicilioNroPuerta: input.domicilioNroPuerta,
            email: input.email ?? null,
            fechaDeNacimiento: input.fechaDeNacimiento,
            id: crypto.randomUUID(),
            nombre: input.nombre,
            nroDocumento: input.nroDocumento,
            nroSocioLegacy: input.nroSocioLegacy,
            razonSocial: null,
            sexo: input.sexo,
            tipoDocumento: input.tipoDocumento,
            tipoPersona: "FISICA",
            updatedAt: new Date("2026-06-19T18:00:00.000Z"),
          }
        : {
            apellido: null,
            celular: input.celular ?? null,
            createdAt: new Date("2026-06-19T18:00:00.000Z"),
            cuit: input.cuit,
            domicilioCalle: input.domicilioCalle,
            domicilioCodigoPostal: input.domicilioCodigoPostal,
            domicilioLocalidad: input.domicilioLocalidad,
            domicilioNroPuerta: input.domicilioNroPuerta,
            email: input.email ?? null,
            fechaDeNacimiento: null,
            id: crypto.randomUUID(),
            nombre: null,
            nroDocumento: null,
            nroSocioLegacy: input.nroSocioLegacy,
            razonSocial: input.razonSocial,
            sexo: null,
            tipoDocumento: null,
            tipoPersona: "JURIDICA",
            updatedAt: new Date("2026-06-19T18:00:00.000Z"),
          };

    this.socios.push(socio);
    return socio;
  }

  async delete(): Promise<void> {
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

  async findById(_id: string): Promise<Socio | null> {
    throw new Error("not used");
  }

  async list() {
    return [...this.socios];
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

  async update(
    _id: string,
    _input: Parameters<SocioRepository["update"]>[1],
  ): Promise<Socio> {
    throw new Error("not used");
  }
}

const DOMICILIO_INPUT = {
  domicilioCalle: "San Martin",
  domicilioCodigoPostal: "2300",
  domicilioLocalidad: "12",
  domicilioNroPuerta: "742",
};

function fakeGateway(
  impl: Partial<CrearSocioMutualGateway> = {},
): CrearSocioMutualGateway {
  return {
    crear: async () => ({ id: "999" }),
    ...impl,
  } as unknown as CrearSocioMutualGateway;
}

describe("CreateSocioUseCase", () => {
  it("calls the legacy gateway and persists with the returned nroSocioLegacy for persona fisica", async () => {
    const repository = new InMemorySocioRepository();
    let receivedInput: unknown;
    const gateway = fakeGateway({
      crear: async (input: unknown) => {
        receivedInput = input;
        return { id: "999" };
      },
    });
    const useCase = new CreateSocioUseCase({ crearSocioMutualGateway: gateway, repository });

    const socio = await useCase.execute({
      apellido: "Perez",
      celular: "11 4444 5555",
      cuit: " 20-12345678-3 ",
      ...DOMICILIO_INPUT,
      email: "user@example.com",
      fechaDeNacimiento: "1990-02-28",
      nombre: "Juan",
      nroDocumento: " 12.345.678 ",
      sexo: "M",
      tipoDocumento: "DNI",
      tipoPersona: "FISICA",
    });

    assert.equal(socio.tipoPersona, "FISICA");
    assert.equal(socio.cuit, "20123456783");
    assert.equal(socio.nroDocumento, "12345678");
    assert.equal(socio.nroSocioLegacy, "999");
    assert.equal(
      socio.tipoPersona === "FISICA" && socio.domicilioCalle,
      "San Martin",
    );
    assert.deepEqual(receivedInput, {
      tipoPersona: "FISICA",
      apellido: "Perez",
      celular: "11 4444 5555",
      cuit: "20123456783",
      domicilio: {
        calle: "San Martin",
        codigoPostal: "2300",
        localidad: "12",
        nroPuerta: "742",
      },
      email: "user@example.com",
      fechaDeNacimiento: "1990-02-28",
      nombre: "Juan",
      nroDocumento: "12345678",
      sexo: "M",
    });
  });

  it("does not persist locally when the legacy gateway rejects the creation", async () => {
    const repository = new InMemorySocioRepository();
    const gateway = fakeGateway({
      crear: async () => {
        throw new Error("legacy rejected");
      },
    });
    const useCase = new CreateSocioUseCase({ crearSocioMutualGateway: gateway, repository });

    await assert.rejects(
      () =>
        useCase.execute({
          apellido: "Perez",
          cuit: "20-12345678-3",
          ...DOMICILIO_INPUT,
          fechaDeNacimiento: "1990-02-28",
          nombre: "Juan",
          nroDocumento: "12345678",
          sexo: "M",
          tipoDocumento: "DNI",
          tipoPersona: "FISICA",
        }),
      /legacy rejected/,
    );
    assert.equal(repository.socios.length, 0);
  });

  it("calls the legacy gateway and persists with the returned nroSocioLegacy for persona juridica", async () => {
    const repository = new InMemorySocioRepository();
    let receivedInput: unknown;
    const gateway = fakeGateway({
      crear: async (input: unknown) => {
        receivedInput = input;
        return { id: "152199" };
      },
    });
    const useCase = new CreateSocioUseCase({ crearSocioMutualGateway: gateway, repository });

    const socio = await useCase.execute({
      cuit: "30-71234567-1",
      ...DOMICILIO_INPUT,
      email: "contacto@elalba.com.ar",
      razonSocial: "Constructora El Alba S.A.",
      tipoPersona: "JURIDICA",
    });

    assert.equal(socio.tipoPersona, "JURIDICA");
    assert.equal(socio.nroSocioLegacy, "152199");
    assert.deepEqual(receivedInput, {
      tipoPersona: "JURIDICA",
      celular: null,
      cuit: "30712345671",
      domicilio: {
        calle: "San Martin",
        codigoPostal: "2300",
        localidad: "12",
        nroPuerta: "742",
      },
      email: "contacto@elalba.com.ar",
      razonSocial: "Constructora El Alba S.A.",
    });
  });

  it("does not persist locally when the legacy gateway rejects a persona juridica creation", async () => {
    const repository = new InMemorySocioRepository();
    const gateway = fakeGateway({
      crear: async () => {
        throw new Error("legacy rejected");
      },
    });
    const useCase = new CreateSocioUseCase({ crearSocioMutualGateway: gateway, repository });

    await assert.rejects(
      () =>
        useCase.execute({
          cuit: "30-71234567-1",
          ...DOMICILIO_INPUT,
          razonSocial: "Constructora El Alba S.A.",
          tipoPersona: "JURIDICA",
        }),
      /legacy rejected/,
    );
    assert.equal(repository.socios.length, 0);
  });

  it("rejects duplicate cuit after normalization without calling the legacy gateway", async () => {
    const repository = new InMemorySocioRepository();
    repository.socios.push({
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
    });
    let gatewayCalled = false;
    const gateway = fakeGateway({
      crear: async () => {
        gatewayCalled = true;
        return { id: "999" };
      },
    });
    const useCase = new CreateSocioUseCase({ crearSocioMutualGateway: gateway, repository });

    await assert.rejects(
      () =>
        useCase.execute({
          apellido: "Gomez",
          cuit: "20.12345678-3",
          ...DOMICILIO_INPUT,
          fechaDeNacimiento: "1992-01-01",
          nombre: "Ana",
          nroDocumento: "87654321",
          sexo: "F",
          tipoDocumento: "DNI",
          tipoPersona: "FISICA",
        }),
      SocioCuitDuplicateError,
    );
    assert.equal(gatewayCalled, false);
  });

  it("rejects duplicate document after normalization without calling the legacy gateway", async () => {
    const repository = new InMemorySocioRepository();
    repository.socios.push({
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
      nroDocumento: "AB12345C",
      nroSocioLegacy: null,
      razonSocial: null,
      sexo: "M",
      tipoDocumento: "DNI",
      tipoPersona: "FISICA",
      updatedAt: new Date(),
    });
    let gatewayCalled = false;
    const gateway = fakeGateway({
      crear: async () => {
        gatewayCalled = true;
        return { id: "999" };
      },
    });
    const useCase = new CreateSocioUseCase({ crearSocioMutualGateway: gateway, repository });

    await assert.rejects(
      () =>
        useCase.execute({
          apellido: "Gomez",
          cuit: "20987654321",
          ...DOMICILIO_INPUT,
          fechaDeNacimiento: "1992-01-01",
          nombre: "Ana",
          nroDocumento: "ab-12.345 c",
          sexo: "F",
          tipoDocumento: "DNI",
          tipoPersona: "FISICA",
        }),
      SocioDocumentoDuplicateError,
    );
    assert.equal(gatewayCalled, false);
  });
});
