import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthRepository } from "../../../auth/domain/repositories/AuthRepository";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import type { CrearPrestamoGateway } from "../../infrastructure/services/CrearPrestamoGateway";
import type { Socio } from "../../../socios/domain/entities/Socio.entity";
import type { SocioRepository } from "../../../socios/domain/repositories/SocioRepository";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";
import {
  ForbiddenSolicitudAccessError,
  SolicitudCoreNotFoundError,
  SolicitudLegacyOidAlreadyExistsError,
  SolicitudPrestamoDataIncompleteError,
  SolicitudTitularSocioLegacyRequiredError,
  SolicitudTitularSocioRequiredForWorkflowError,
  SolicitudVendedorLegacyRequiredError,
} from "../../domain/solicitudes-core-errors";
import { CreatePrestamoLegacyUseCase } from "./CreatePrestamoLegacy.use-case";

const TODAY = "2026-07-22";

describe("CreatePrestamoLegacyUseCase", () => {
  it("builds the payload from the solicitud and titular socio, calls the gateway, and persists legacyOid", async () => {
    let receivedInput: unknown;
    const gateway = fakeGateway({
      crear: async (input: unknown) => {
        receivedInput = input;
        return { id: "555000" };
      },
    });
    let receivedUpdate: { id: string; patch: unknown } | undefined;
    const repository = solicitudesRepository({
      update: async (id, patch) => {
        receivedUpdate = { id, patch };
        return solicitud({ legacyOid: "555000" });
      },
    });
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository(),
      gateway,
      repository,
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    const result = await useCase.execute({
      currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
      solicitudId: "sol-1",
    });

    assert.equal(result.legacyOid, "555000");
    assert.deepEqual(receivedInput, {
      cuotas: 6,
      fechaEmision: TODAY,
      integrantes: [{ socio: "143471", tipoRelacion: "Titular" }],
      lineaPrestamo: "LP-1",
      montoDeseado: "10000",
      vendedor: "347",
    });
    assert.deepEqual(receivedUpdate, {
      id: "sol-1",
      patch: {
        solicitud: {
          legacyOid: "555000",
          linkFirmaDigital:
            "https://redunisol.com.ar/finalizar.php?linea=Personal&ntrans=0&sol=555000",
        },
      },
    });
  });

  it("allows a system admin regardless of ownerId", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.doesNotReject(() =>
      useCase.execute({
        currentUser: {
          id: "admin-1",
          isSystemAdmin: true,
          workflowOwnerId: "some-other-owner",
        },
        solicitudId: "sol-1",
      }),
    );
  });

  it("throws SolicitudCoreNotFoundError when the solicitud does not exist", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository({ findById: async () => null }),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "missing",
        }),
      SolicitudCoreNotFoundError,
    );
  });

  it("throws SolicitudLegacyOidAlreadyExistsError when legacyOid is already set", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository({
        findById: async () => solicitud({ legacyOid: "111" }),
      }),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudLegacyOidAlreadyExistsError,
    );
  });

  it("throws ForbiddenSolicitudAccessError when the current user is not the solicitud owner", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "some-other-owner" },
          solicitudId: "sol-1",
        }),
      ForbiddenSolicitudAccessError,
    );
  });

  it("throws SolicitudPrestamoDataIncompleteError listing missing fields when montoAFinanciar and cuotas are null", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository({
        findById: async () => solicitud({ cuotas: null, montoAFinanciar: null }),
      }),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      (error: unknown) => {
        assert.ok(error instanceof SolicitudPrestamoDataIncompleteError);
        assert.deepEqual(error.missingFieldLabels, [
          "Monto a financiar",
          "Cuotas",
        ]);
        return true;
      },
    );
  });

  it("throws SolicitudTitularSocioRequiredForWorkflowError when no socio matches the titular", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository({ lookupByDocumento: async () => [] }),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudTitularSocioRequiredForWorkflowError,
    );
  });

  it("throws SolicitudTitularSocioLegacyRequiredError when the socio has no nroSocioLegacy", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository({
        lookupByDocumento: async () => [buildSocio({ nroSocioLegacy: null })],
      }),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudTitularSocioLegacyRequiredError,
    );
  });

  it("does not persist anything when the gateway rejects the creation", async () => {
    let updateCalled = false;
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository(),
      gateway: fakeGateway({
        crear: async () => {
          throw new Error("legacy rejected");
        },
      }),
      repository: solicitudesRepository({
        update: async () => {
          updateCalled = true;
          throw new Error("should not be called");
        },
      }),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      /legacy rejected/,
    );
    assert.equal(updateCalled, false);
  });

  it("throws SolicitudVendedorLegacyRequiredError when the creator user is not found", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository({ findById: async () => null }),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway(),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudVendedorLegacyRequiredError,
    );
  });

  it("throws SolicitudVendedorLegacyRequiredError when the creator has no legacy user id", async () => {
    const useCase = new CreatePrestamoLegacyUseCase({
      authRepository: authRepository(),
      gateway: fakeGateway(),
      repository: solicitudesRepository(),
      sociosRepository: socioRepository(),
      solicitudesLegacyGateway: solicitudesLegacyGateway({
        getVendedorLegacyId: async () => null,
      }),
      today: () => TODAY,
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-2" },
          solicitudId: "sol-1",
        }),
      SolicitudVendedorLegacyRequiredError,
    );
  });
});

function fakeGateway(
  impl: Partial<CrearPrestamoGateway> = {},
): CrearPrestamoGateway {
  return {
    crear: async () => ({ id: "999" }),
    ...impl,
  } as unknown as CrearPrestamoGateway;
}

function authRepository(
  overrides: Partial<Pick<AuthRepository, "findById">> = {},
): Pick<AuthRepository, "findById"> {
  return {
    findById: async () => buildAuthUser(),
    ...overrides,
  };
}

function buildAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    email: "vendedor@example.com",
    emailVerified: true,
    firstName: "Vendedor",
    id: "user-1",
    isSystemAdmin: false,
    lastName: "Uno",
    legacyUser: "VUSER",
    state: 1,
    workflowOwnerId: null,
    ...overrides,
  };
}

function solicitudesLegacyGateway(
  overrides: Partial<
    Pick<SolicitudesLegacyGateway, "getVendedorLegacyId">
  > = {},
): Pick<SolicitudesLegacyGateway, "getVendedorLegacyId"> {
  return {
    getVendedorLegacyId: async () => 347,
    ...overrides,
  };
}

function buildSocio(overrides: Partial<Socio> = {}): Socio {
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
    ...overrides,
  } as Socio;
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

function solicitud(overrides: Partial<SolicitudCore> = {}): SolicitudCore {
  return {
    id: "sol-1",
    createdAt: new Date("2026-05-18T10:00:00.000Z"),
    createdBy: "user-1",
    cuotaResultante: null,
    cuotas: 6,
    ejecutivoSolicitud: null,
    estadoActual: {
      code: "Confirmada",
      id: "state-4",
      name: "Confirmada",
      ownerId: "owner-2",
    },
    firmaDigitalmente: false,
    legacyOid: null,
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    montoAFinanciar: 10000,
    motivo: null,
    nroSolicitud: null,
    observaciones: null,
    garantias: [],
    conyuge: null,
    datosLaborales: {
      actividadLaboral: null,
      antiguedadLaboralMeses: null,
      descuentosSueldo: null,
      domicilioLaboralCalle: null,
      domicilioLaboralLocalidad: null,
      domicilioLaboralNroPuerta: null,
      domicilioLaboralPisoDepto: null,
      empleador: null,
      fechaIngresoLaboral: null,
      montoRecibo: null,
      relacionLaboral: null,
      tarjetas: null,
      vehiculo: null,
      vivienda: null,
    },
    titular: {
      apellidoDenominacion: "Perez",
      cbu: null,
      celular: null,
      cuit: "20-33344455-9",
      domicilioCalle: null,
      email: null,
      localidad: null,
      nombre: "Juan",
      nroDocumento: "33.344.455",
      nroPuerta: null,
      nroSocio: null,
      sexo: null,
      tipoDocumento: "DNI",
    },
    updatedAt: new Date("2026-05-18T10:00:00.000Z"),
    vendedorSolicitud: null,
    ...overrides,
  };
}

function solicitudesRepository(
  overrides: Partial<SolicitudesCoreRepository> = {},
): SolicitudesCoreRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    findById: async () => solicitud(),
    listByOwner: async () => [],
    update: async () => solicitud({ legacyOid: "999" }),
    ...overrides,
  };
}
