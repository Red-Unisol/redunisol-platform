import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ListSolicitudCancelacionesInput } from "../dtos/ListSolicitudCancelaciones.dto";
import { SolicitudCancelacionNotFoundError } from "../../domain/solicitudes-cancelaciones-errors";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { ownedSolicitud, storedCancelacion } from "./CancelacionesUseCaseTest.fixtures";
import { ListSolicitudCancelacionesUseCase } from "./ListSolicitudCancelaciones.use-case";

const listInput = (): ListSolicitudCancelacionesInput => ({
  solicitudId: "sol-1",
  currentUser: {
    id: "user-1",
    workflowOwnerId: "owner-1",
  },
});

describe("ListSolicitudCancelacionesUseCase", () => {
  it("returns only non deleted cancelaciones for the solicitud", async () => {
    const useCase = new ListSolicitudCancelacionesUseCase({
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => {
          throw new Error("not used");
        },
        listBySolicitudId: async () => [
          storedCancelacion({ id: "canc-1" }),
          storedCancelacion({
            id: "canc-2",
            deletedAt: new Date("2026-05-13T10:00:00.000Z"),
          }),
        ],
        softDelete: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: createSolicitudesRepository(),
    });

    const result = await useCase.execute(listInput());

    assert.deepEqual(
      result.map((cancelacion) => cancelacion.id),
      ["canc-1"],
    );
  });

  it("returns an empty list when there are no cancelaciones", async () => {
    const useCase = new ListSolicitudCancelacionesUseCase({
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => {
          throw new Error("not used");
        },
        listBySolicitudId: async () => [],
        softDelete: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: createSolicitudesRepository(),
    });

    const result = await useCase.execute(listInput());

    assert.deepEqual(result, []);
  });

  it("rejects when the solicitud does not exist", async () => {
    const useCase = new ListSolicitudCancelacionesUseCase({
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => {
          throw new Error("not used");
        },
        listBySolicitudId: async () => {
          throw new Error("not used");
        },
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
        findById: async () => null,
        listByOwner: async () => [],
        update: async () => {
          throw new Error("not used");
        },
      },
    });

    await assert.rejects(
      () => useCase.execute(listInput()),
      SolicitudCancelacionNotFoundError,
    );
  });
});

function createSolicitudesRepository(): SolicitudesCoreRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    findById: async () => ownedSolicitud(),
    listByOwner: async () => [],
    update: async () => {
      throw new Error("not used");
    },
  };
}
