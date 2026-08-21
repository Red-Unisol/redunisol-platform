import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import {
  ForbiddenSolicitudAccessError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudAssignmentNotAllowedError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import { ListAssignableSolicitudAgentsUseCase } from "./ListAssignableSolicitudAgents.use-case";

describe("ListAssignableSolicitudAgentsUseCase", () => {
  it("returns assignable agents from solicitud current owner", async () => {
    const useCase = new ListAssignableSolicitudAgentsUseCase({
      repository: {
        ...repositoryBase(),
        listUsersByWorkflowOwnerId: async () => [
          { email: "agent1@example.com", fullName: "Agent One", id: "agent-1" },
          { email: "agent2@example.com", fullName: null, id: "agent-2" },
        ],
      },
    });

    const result = await useCase.execute({
      currentUser: { id: "user-1", workflowOwnerId: "owner-riesgo" },
      solicitudId: "sol-1",
    });

    assert.deepEqual(result, [
      { email: "agent1@example.com", fullName: "Agent One", id: "agent-1" },
      { email: "agent2@example.com", fullName: null, id: "agent-2" },
    ]);
  });

  it("rejects when user has no workflow owner", async () => {
    const useCase = new ListAssignableSolicitudAgentsUseCase({
      repository: repositoryBase(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: null },
          solicitudId: "sol-1",
        }),
      MissingWorkflowOwnerAssignmentError,
    );
  });

  it("rejects when solicitud does not exist", async () => {
    const useCase = new ListAssignableSolicitudAgentsUseCase({
      repository: {
        ...repositoryBase(),
        findById: async () => null,
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-riesgo" },
          solicitudId: "missing",
        }),
      SolicitudCoreNotFoundError,
    );
  });

  it("rejects when current user is outside solicitud owner", async () => {
    const useCase = new ListAssignableSolicitudAgentsUseCase({
      repository: repositoryBase(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: { id: "user-1", workflowOwnerId: "owner-vendedores" },
          solicitudId: "sol-1",
        }),
      ForbiddenSolicitudAccessError,
    );
  });

  it("rejects when solicitud is in Motor/SISTEMA", async () => {
    const useCase = new ListAssignableSolicitudAgentsUseCase({
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
          currentUser: { id: "user-1", workflowOwnerId: "owner-sistema" },
          solicitudId: "sol-1",
        }),
      SolicitudAssignmentNotAllowedError,
    );
  });

  it("allows a system admin to list all assignable agents regardless of solicitud owner", async () => {
    let receivedOwnerId: unknown;
    let callCount = 0;
    const useCase = new ListAssignableSolicitudAgentsUseCase({
      repository: {
        ...repositoryBase(),
        listUsersByWorkflowOwnerId: async (ownerId) => {
          callCount += 1;
          receivedOwnerId = ownerId;
          return [
            { email: "agent1@example.com", fullName: "Agent One", id: "agent-1" },
          ];
        },
      },
    });

    const result = await useCase.execute({
      currentUser: { id: "admin-1", isSystemAdmin: true, workflowOwnerId: null },
      solicitudId: "sol-1",
    });

    assert.equal(callCount, 1);
    assert.equal(receivedOwnerId, undefined);
    assert.deepEqual(result, [
      { email: "agent1@example.com", fullName: "Agent One", id: "agent-1" },
    ]);
  });

  it("allows a system admin to list all assignable agents outside RIESGO ownership", async () => {
    let receivedOwnerId: unknown;
    const useCase = new ListAssignableSolicitudAgentsUseCase({
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
        listUsersByWorkflowOwnerId: async (ownerId) => {
          receivedOwnerId = ownerId;
          return [];
        },
      },
    });

    await useCase.execute({
      currentUser: { id: "admin-1", isSystemAdmin: true, workflowOwnerId: null },
      solicitudId: "sol-1",
    });

    assert.equal(receivedOwnerId, undefined);
  });

  it("allows a system admin to list all assignable agents in Motor/SISTEMA state", async () => {
    let receivedOwnerId: unknown;
    const useCase = new ListAssignableSolicitudAgentsUseCase({
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
        listUsersByWorkflowOwnerId: async (ownerId) => {
          receivedOwnerId = ownerId;
          return [];
        },
      },
    });

    await useCase.execute({
      currentUser: { id: "admin-1", isSystemAdmin: true, workflowOwnerId: null },
      solicitudId: "sol-1",
    });

    assert.equal(receivedOwnerId, undefined);
  });

  it("rejects listing agents outside RIESGO owners", async () => {
    const useCase = new ListAssignableSolicitudAgentsUseCase({
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
          currentUser: { id: "user-1", workflowOwnerId: "owner-vendedores" },
          solicitudId: "sol-1",
        }),
      SolicitudAssignmentNotAllowedError,
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
    listUsersByWorkflowOwnerId: async () => [],
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
    participants: [{ role: "WATCHER", source: "SYSTEM", userId: "p-1" }],
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
