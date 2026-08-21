import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import {
  ForbiddenSolicitudAccessError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudAlreadyAssignedError,
  SolicitudAssignmentNotAllowedError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import { AssignSolicitudToSelfUseCase } from "./AssignSolicitudToSelf.use-case";

describe("AssignSolicitudToSelfUseCase", () => {
  it("assigns unassigned solicitud to current owner user", async () => {
    let assignCalls = 0;
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: {
        ...repositoryBase(),
        assignToUserIfUnassigned: async (input) => {
          assignCalls += 1;
          receivedInput = input;
          return solicitud({ assignedToUserId: input.assignedToUserId });
        },
      },
    });

    const result = await useCase.execute({
      currentUser: {
        id: "operator-1",
        workflowOwnerId: "owner-riesgo",
      },
      solicitudId: "sol-1",
    });

    assert.equal(result.assignedToUserId, "operator-1");
    assert.equal(assignCalls, 1);
    assert.deepEqual(receivedInput, {
      actorUserId: "operator-1",
      allowReassignment: true,
      assignedToUserId: "operator-1",
      solicitudId: "sol-1",
    });
  });

  it("allows an analista to self-assign a solicitud outside RIESGO ownership", async () => {
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: {
        ...repositoryBase(),
        findById: async () =>
          solicitud({
            estadoActual: {
              code: "CargaVendedor",
              id: "state-carga",
              name: "Carga vendedor",
              owner: { code: "VENDEDORES", id: "owner-vendedores", name: "Vendedores" },
              ownerId: "owner-vendedores",
            },
          }),
        assignToUserIfUnassigned: async (input) => {
          receivedInput = input;
          return solicitud({ assignedToUserId: input.assignedToUserId });
        },
      },
    });

    const result = await useCase.execute({
      currentUser: {
        id: "riesgo-1",
        isAnalista: true,
        workflowOwnerId: "owner-riesgo",
      },
      solicitudId: "sol-1",
    });

    assert.equal(result.assignedToUserId, "riesgo-1");
    assert.deepEqual(receivedInput, {
      actorUserId: "riesgo-1",
      allowReassignment: false,
      assignedToUserId: "riesgo-1",
      solicitudId: "sol-1",
    });
  });

  it("rejects when solicitud does not exist", async () => {
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: {
        ...repositoryBase(),
        findById: async () => null,
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "operator-1",
            workflowOwnerId: "owner-riesgo",
          },
          solicitudId: "missing",
        }),
      SolicitudCoreNotFoundError,
    );
  });

  it("rejects when current user has no workflow owner", async () => {
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: repositoryBase(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "operator-1",
            workflowOwnerId: null,
          },
          solicitudId: "sol-1",
        }),
      MissingWorkflowOwnerAssignmentError,
    );
  });

  it("rejects when current user is outside solicitud owner", async () => {
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: repositoryBase(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "operator-1",
            workflowOwnerId: "owner-vendedores",
          },
          solicitudId: "sol-1",
        }),
      ForbiddenSolicitudAccessError,
    );
  });

  it("rejects reassignment when solicitud owner is not RIESGO and user is not admin", async () => {
    let assignCalls = 0;
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: {
        ...repositoryBase(),
        assignToUserIfUnassigned: async () => {
          assignCalls += 1;
          return solicitud({ assignedToUserId: "operator-1" });
        },
        findById: async () =>
          solicitud({
            assignedToUserId: "existing-user",
            estadoActual: {
              code: "CargaVendedor",
              id: "state-carga",
              name: "Carga vendedor",
              owner: {
                code: "VENDEDORES",
                id: "owner-vendedores",
                name: "Vendedores",
              },
              ownerId: "owner-vendedores",
            },
          }),
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "operator-1",
            workflowOwnerId: "owner-vendedores",
          },
          solicitudId: "sol-1",
        }),
      SolicitudAlreadyAssignedError,
    );
    assert.equal(assignCalls, 0);
  });

  it("allows a system admin to reassign an already-assigned solicitud in any state", async () => {
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: {
        ...repositoryBase(),
        assignToUserIfUnassigned: async (input) => {
          receivedInput = input;
          return solicitud({ assignedToUserId: input.assignedToUserId });
        },
        findById: async () =>
          solicitud({
            assignedToUserId: "existing-user",
            estadoActual: {
              code: "CargaVendedor",
              id: "state-carga",
              name: "Carga vendedor",
              owner: {
                code: "VENDEDORES",
                id: "owner-vendedores",
                name: "Vendedores",
              },
              ownerId: "owner-vendedores",
            },
          }),
      },
    });

    const result = await useCase.execute({
      currentUser: {
        id: "admin-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      solicitudId: "sol-1",
    });

    assert.equal(result.assignedToUserId, "admin-1");
    assert.deepEqual(receivedInput, {
      actorUserId: "admin-1",
      allowReassignment: true,
      assignedToUserId: "admin-1",
      solicitudId: "sol-1",
    });
  });

  it("allows a RIESGO-owner user to freely reassign an already-assigned solicitud while it is owned by RIESGO", async () => {
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: {
        ...repositoryBase(),
        assignToUserIfUnassigned: async (input) => {
          receivedInput = input;
          return solicitud({ assignedToUserId: input.assignedToUserId });
        },
        findById: async () => solicitud({ assignedToUserId: "existing-user" }),
      },
    });

    const result = await useCase.execute({
      currentUser: {
        id: "operator-1",
        workflowOwnerId: "owner-riesgo",
      },
      solicitudId: "sol-1",
    });

    assert.equal(result.assignedToUserId, "operator-1");
    assert.deepEqual(receivedInput, {
      actorUserId: "operator-1",
      allowReassignment: true,
      assignedToUserId: "operator-1",
      solicitudId: "sol-1",
    });
  });

  it("rejects owner SISTEMA", async () => {
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: {
        ...repositoryBase(),
        findById: async () =>
          solicitud({
            estadoActual: {
              code: "Motor",
              id: "state-motor",
              name: "Motor",
              owner: {
                code: "SISTEMA",
                id: "owner-sistema",
                name: "Sistema",
              },
              ownerId: "owner-sistema",
            },
          }),
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "operator-1",
            workflowOwnerId: "owner-sistema",
          },
          solicitudId: "sol-1",
        }),
      SolicitudAssignmentNotAllowedError,
    );
  });

  it("rejects assignment outside RIESGO owners", async () => {
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: {
        ...repositoryBase(),
        findById: async () =>
          solicitud({
            estadoActual: {
              code: "CargaVendedor",
              id: "state-carga",
              name: "Carga vendedor",
              owner: {
                code: "VENDEDORES",
                id: "owner-vendedores",
                name: "Vendedores",
              },
              ownerId: "owner-vendedores",
            },
          }),
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "operator-1",
            workflowOwnerId: "owner-vendedores",
          },
          solicitudId: "sol-1",
        }),
      SolicitudAssignmentNotAllowedError,
    );
  });

  it("allows a system admin to self-assign outside RIESGO ownership and without a workflow owner", async () => {
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: {
        ...repositoryBase(),
        assignToUserIfUnassigned: async (input) => {
          receivedInput = input;
          return solicitud({ assignedToUserId: input.assignedToUserId });
        },
        findById: async () =>
          solicitud({
            estadoActual: {
              code: "CargaVendedor",
              id: "state-carga",
              name: "Carga vendedor",
              owner: {
                code: "VENDEDORES",
                id: "owner-vendedores",
                name: "Vendedores",
              },
              ownerId: "owner-vendedores",
            },
          }),
      },
    });

    const result = await useCase.execute({
      currentUser: {
        id: "admin-1",
        isSystemAdmin: true,
        workflowOwnerId: null,
      },
      solicitudId: "sol-1",
    });

    assert.equal(result.assignedToUserId, "admin-1");
    assert.deepEqual(receivedInput, {
      actorUserId: "admin-1",
      allowReassignment: true,
      assignedToUserId: "admin-1",
      solicitudId: "sol-1",
    });
  });

  it("rejects race when assignment was taken between read and write", async () => {
    const useCase = new AssignSolicitudToSelfUseCase({
      repository: {
        ...repositoryBase(),
        assignToUserIfUnassigned: async () => null,
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "operator-1",
            workflowOwnerId: "owner-riesgo",
          },
          solicitudId: "sol-1",
        }),
      SolicitudAlreadyAssignedError,
    );
  });
});

function repositoryBase(): SolicitudesCoreRepository {
  return {
    assignToUserIfUnassigned: async () => solicitud({ assignedToUserId: "operator-1" }),
    create: async () => {
      throw new Error("not used");
    },
    findById: async () => solicitud(),
    findUserById: async () => null,
    listByOwner: async () => [],
    listTracking: async () => [],
    update: async () => {
      throw new Error("not used");
    },
  };
}

function solicitud(overrides: Partial<SolicitudCore> = {}): SolicitudCore {
  return {
    assignedToUserId: null,
    conyuge: null,
    createdAt: new Date("2026-05-12T10:00:00.000Z"),
    createdBy: "creator-1",
    cuotaResultante: null,
    cuotas: null,
    cupoTitular: null,
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
    ejecutivoSolicitud: null,
    estadoActual: {
      code: "RevisionRiesgo",
      id: "state-riesgo",
      name: "Revision riesgo",
      owner: {
        code: "RIESGO",
        id: "owner-riesgo",
        name: "Riesgo",
      },
      ownerId: "owner-riesgo",
    },
    firmaDigitalmente: false,
    garantias: [],
    id: "sol-1",
    legacyOid: null,
    lineaPrestamoDescripcion: "Personal",
    lineaPrestamoLegacyOid: "LP-1",
    montoAFinanciar: null,
    motivo: null,
    nroOperacion: null,
    nroSolicitud: null,
    observaciones: null,
    participants: [{ role: "ASSIGNED", source: "MANUAL_ASSIGNMENT", userId: "p-1" }],
    titular: {
      apellidoDenominacion: null,
      cbu: null,
      celular: null,
      cuit: null,
      domicilioCalle: null,
      email: null,
      localidad: null,
      nombre: null,
      nroDocumento: null,
      nroPuerta: null,
      nroSocio: null,
      tipoDocumento: null,
    },
    updatedAt: new Date("2026-05-12T10:00:00.000Z"),
    vendedorSolicitud: null,
    ...overrides,
  };
}
