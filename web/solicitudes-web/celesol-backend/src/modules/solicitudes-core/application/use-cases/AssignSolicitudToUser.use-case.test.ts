import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import {
  ForbiddenSolicitudAccessError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudAlreadyAssignedError,
  SolicitudAssignmentNotAllowedError,
  SolicitudCoreNotFoundError,
  TargetUserNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import { AssignSolicitudToUserUseCase } from "./AssignSolicitudToUser.use-case";

describe("AssignSolicitudToUserUseCase", () => {
  it("assigns unassigned solicitud to target user in same owner", async () => {
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToUserUseCase({
      repository: {
        ...repositoryBase(),
        assignToUserIfUnassigned: async (input) => {
          receivedInput = input;
          return solicitud({ assignedToUserId: input.assignedToUserId });
        },
        findUserById: async () => ({
          id: "target-1",
          workflowOwnerId: "owner-riesgo",
        }),
      },
    });

    const result = await useCase.execute({
      currentUser: {
        id: "operator-1",
        workflowOwnerId: "owner-riesgo",
      },
      solicitudId: "sol-1",
      targetUserId: "target-1",
    });

    assert.equal(result.assignedToUserId, "target-1");
    assert.deepEqual(receivedInput, {
      actorUserId: "operator-1",
      allowReassignment: true,
      assignedToUserId: "target-1",
      solicitudId: "sol-1",
    });
  });

  it("rejects missing solicitud", async () => {
    const useCase = new AssignSolicitudToUserUseCase({
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
          targetUserId: "target-1",
        }),
      SolicitudCoreNotFoundError,
    );
  });

  it("rejects when target user does not exist", async () => {
    const useCase = new AssignSolicitudToUserUseCase({
      repository: {
        ...repositoryBase(),
        findUserById: async () => null,
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
          targetUserId: "target-404",
        }),
      TargetUserNotFoundError,
    );
  });

  it("rejects when target user has no owner", async () => {
    const useCase = new AssignSolicitudToUserUseCase({
      repository: {
        ...repositoryBase(),
        findUserById: async () => ({
          id: "target-1",
          workflowOwnerId: null,
        }),
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
          targetUserId: "target-1",
        }),
      MissingWorkflowOwnerAssignmentError,
    );
  });

  it("rejects when target user is from another owner", async () => {
    const useCase = new AssignSolicitudToUserUseCase({
      repository: {
        ...repositoryBase(),
        findUserById: async () => ({
          id: "target-1",
          workflowOwnerId: "owner-vendedores",
        }),
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
          targetUserId: "target-1",
        }),
      ForbiddenSolicitudAccessError,
    );
  });

  it("rejects when current user is outside solicitud owner", async () => {
    let assignCalls = 0;
    const useCase = new AssignSolicitudToUserUseCase({
      repository: {
        ...repositoryBase(),
        assignToUserIfUnassigned: async () => {
          assignCalls += 1;
          return solicitud({ assignedToUserId: "target-1" });
        },
        findUserById: async () => ({
          id: "target-1",
          workflowOwnerId: "owner-riesgo",
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
          targetUserId: "target-1",
      }),
      ForbiddenSolicitudAccessError,
    );
    assert.equal(assignCalls, 0);
  });

  it("rejects reassignment when solicitud owner is not RIESGO and user is not admin", async () => {
    const useCase = new AssignSolicitudToUserUseCase({
      repository: {
        ...repositoryBase(),
        findById: async () =>
          solicitud({
            assignedToUserId: "another-user",
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
        findUserById: async () => ({
          id: "target-1",
          workflowOwnerId: "owner-vendedores",
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
          targetUserId: "target-1",
        }),
      SolicitudAlreadyAssignedError,
    );
  });

  it("allows a system admin to reassign an already-assigned solicitud in any state", async () => {
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToUserUseCase({
      repository: {
        ...repositoryBase(),
        assignToUserIfUnassigned: async (input) => {
          receivedInput = input;
          return solicitud({ assignedToUserId: input.assignedToUserId });
        },
        findById: async () =>
          solicitud({
            assignedToUserId: "another-user",
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
        findUserById: async () => ({
          id: "target-1",
          workflowOwnerId: "owner-vendedores",
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
      targetUserId: "target-1",
    });

    assert.equal(result.assignedToUserId, "target-1");
    assert.deepEqual(receivedInput, {
      actorUserId: "admin-1",
      allowReassignment: true,
      assignedToUserId: "target-1",
      solicitudId: "sol-1",
    });
  });

  it("allows a RIESGO-owner user to freely reassign an already-assigned solicitud while it is owned by RIESGO", async () => {
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToUserUseCase({
      repository: {
        ...repositoryBase(),
        assignToUserIfUnassigned: async (input) => {
          receivedInput = input;
          return solicitud({ assignedToUserId: input.assignedToUserId });
        },
        findById: async () => solicitud({ assignedToUserId: "another-user" }),
      },
    });

    const result = await useCase.execute({
      currentUser: {
        id: "operator-1",
        workflowOwnerId: "owner-riesgo",
      },
      solicitudId: "sol-1",
      targetUserId: "target-1",
    });

    assert.equal(result.assignedToUserId, "target-1");
    assert.deepEqual(receivedInput, {
      actorUserId: "operator-1",
      allowReassignment: true,
      assignedToUserId: "target-1",
      solicitudId: "sol-1",
    });
  });

  it("rejects owner SISTEMA / Motor state", async () => {
    const useCase = new AssignSolicitudToUserUseCase({
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
          targetUserId: "target-1",
        }),
      SolicitudAssignmentNotAllowedError,
    );
  });

  it("rejects assignment outside RIESGO owners", async () => {
    const useCase = new AssignSolicitudToUserUseCase({
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
          targetUserId: "target-1",
        }),
      SolicitudAssignmentNotAllowedError,
    );
  });

  it("allows a system admin to assign outside RIESGO ownership and without a workflow owner", async () => {
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToUserUseCase({
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
        findUserById: async () => ({
          id: "target-1",
          workflowOwnerId: "owner-vendedores",
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
      targetUserId: "target-1",
    });

    assert.equal(result.assignedToUserId, "target-1");
    assert.deepEqual(receivedInput, {
      actorUserId: "admin-1",
      allowReassignment: true,
      assignedToUserId: "target-1",
      solicitudId: "sol-1",
    });
  });

  it("allows a system admin to assign to a target user from a different owner than the solicitud", async () => {
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToUserUseCase({
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
              owner: { code: "VENDEDORES", id: "owner-vendedores", name: "Vendedores" },
              ownerId: "owner-vendedores",
            },
          }),
        findUserById: async () => ({
          id: "target-1",
          workflowOwnerId: "owner-riesgo",
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
      targetUserId: "target-1",
    });

    assert.equal(result.assignedToUserId, "target-1");
    assert.deepEqual(receivedInput, {
      actorUserId: "admin-1",
      allowReassignment: true,
      assignedToUserId: "target-1",
      solicitudId: "sol-1",
    });
  });

  it("allows an analista to assign a solicitud outside RIESGO ownership to another analista", async () => {
    let receivedInput: unknown;
    const useCase = new AssignSolicitudToUserUseCase({
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
              owner: { code: "VENDEDORES", id: "owner-vendedores", name: "Vendedores" },
              ownerId: "owner-vendedores",
            },
          }),
        findUserById: async () => ({
          id: "target-1",
          workflowOwnerId: "owner-riesgo",
        }),
      },
    });

    const result = await useCase.execute({
      currentUser: {
        id: "riesgo-1",
        isAnalista: true,
        workflowOwnerId: "owner-riesgo",
      },
      solicitudId: "sol-1",
      targetUserId: "target-1",
    });

    assert.equal(result.assignedToUserId, "target-1");
    assert.deepEqual(receivedInput, {
      actorUserId: "riesgo-1",
      allowReassignment: false,
      assignedToUserId: "target-1",
      solicitudId: "sol-1",
    });
  });

  it("rejects an analista assigning to a target user who is not also an analista", async () => {
    const useCase = new AssignSolicitudToUserUseCase({
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
        findUserById: async () => ({
          id: "target-1",
          workflowOwnerId: "owner-vendedores",
        }),
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "riesgo-1",
            isAnalista: true,
            workflowOwnerId: "owner-riesgo",
          },
          solicitudId: "sol-1",
          targetUserId: "target-1",
        }),
      ForbiddenSolicitudAccessError,
    );
  });
});

function repositoryBase(): SolicitudesCoreRepository {
  return {
    assignToUserIfUnassigned: async () => solicitud({ assignedToUserId: "target-1" }),
    create: async () => {
      throw new Error("not used");
    },
    findById: async () => solicitud(),
    findUserById: async () => ({
      id: "target-1",
      workflowOwnerId: "owner-riesgo",
    }),
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
