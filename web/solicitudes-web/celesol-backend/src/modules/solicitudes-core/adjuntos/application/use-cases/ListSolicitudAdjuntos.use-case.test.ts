import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ListSolicitudAdjuntosInput } from "../dtos/ListSolicitudAdjuntos.dto";
import type { SolicitudAdjuntoRepository } from "../../domain/repositories/SolicitudAdjuntoRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { ownedSolicitud, storedAdjunto } from "./AdjuntosUseCaseTest.fixtures";
import { ListSolicitudAdjuntosUseCase } from "./ListSolicitudAdjuntos.use-case";

const listInput = (): ListSolicitudAdjuntosInput => ({
  currentUser: {
    id: "user-1",
    workflowOwnerId: "owner-1",
  },
  solicitudId: "sol-1",
  workflowOwnerId: "owner-1",
});

describe("ListSolicitudAdjuntosUseCase", () => {
  it("filters out soft-deleted rows returned by the repository", async () => {
    const solicitudesRepository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () => ownedSolicitud(),
      listByOwner: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    };
    const repository: SolicitudAdjuntoRepository = {
      create: async () => {
        throw new Error("not used");
      },
      createMany: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listBySolicitudId: async () => [
        storedAdjunto({
          id: "adj-1",
          archivoNombre: "adj-1.pdf",
          archivoPath: "solicitudes/sol-1/adjuntos/adj-1.pdf",
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
        }),
        storedAdjunto({
          id: "adj-2",
          archivoNombre: "adj-2.pdf",
          archivoPath: "solicitudes/sol-1/adjuntos/adj-2.pdf",
          deletedAt: new Date("2026-05-13T10:00:00.000Z"),
          deletedBy: "user-1",
          deleteReason: "Cleanup",
        }),
      ],
      softDelete: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudAdjuntosUseCase({
      repository,
      solicitudesRepository,
    });

    const result = await useCase.execute(listInput());

    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "adj-1");
    assert.equal(result[0]?.deletedAt, null);
  });

  it("lists adjuntos for the creator outside the current workflow owner", async () => {
    const solicitudesRepository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () =>
        ownedSolicitud({
          createdBy: "creator-1",
          estadoActual: {
            code: "RevisionRiesgo",
            id: "state-2",
            name: "Revision riesgo",
            ownerId: "owner-2",
          },
          participants: [],
        }),
      listByOwner: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    };
    const repository: SolicitudAdjuntoRepository = {
      create: async () => {
        throw new Error("not used");
      },
      createMany: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listBySolicitudId: async () => [storedAdjunto()],
      softDelete: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudAdjuntosUseCase({
      repository,
      solicitudesRepository,
    });

    const result = await useCase.execute({
      currentUser: {
        id: "creator-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });

    assert.equal(result.length, 1);
  });

  it("lists adjuntos for a participant outside the current workflow owner", async () => {
    const solicitudesRepository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () =>
        ownedSolicitud({
          createdBy: "creator-1",
          estadoActual: {
            code: "RevisionRiesgo",
            id: "state-2",
            name: "Revision riesgo",
            ownerId: "owner-2",
          },
          participants: [{ userId: "participant-1" }],
        }),
      listByOwner: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    };
    const repository: SolicitudAdjuntoRepository = {
      create: async () => {
        throw new Error("not used");
      },
      createMany: async () => {
        throw new Error("not used");
      },
      findById: async () => null,
      listBySolicitudId: async () => [storedAdjunto()],
      softDelete: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new ListSolicitudAdjuntosUseCase({
      repository,
      solicitudesRepository,
    });

    const result = await useCase.execute({
      currentUser: {
        id: "participant-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });

    assert.equal(result.length, 1);
  });

  it("lists adjuntos for any authenticated user outside the current owner", async () => {
    const useCase = new ListSolicitudAdjuntosUseCase({
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        listBySolicitudId: async () => [storedAdjunto()],
        softDelete: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () =>
          ownedSolicitud({
            createdBy: "user-2",
            estadoActual: {
              code: "CargaVendedor",
              id: "state-1",
              name: "Carga vendedor",
              ownerId: "owner-2",
            },
            participants: [],
          }),
        listByOwner: async () => [],
        update: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await useCase.execute(listInput());

    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "adj-1");
  });
});
