import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DeleteSolicitudAdjuntoInput } from "../dtos/DeleteSolicitudAdjunto.dto";
import type { SolicitudAdjuntoRepository } from "../../domain/repositories/SolicitudAdjuntoRepository";
import {
  ForbiddenSolicitudAdjuntoAccessError,
  SolicitudAdjuntoNotFoundError,
} from "../../domain/solicitudes-adjuntos-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { ownedSolicitud, storedAdjunto } from "./AdjuntosUseCaseTest.fixtures";
import { DeleteSolicitudAdjuntoUseCase } from "./DeleteSolicitudAdjunto.use-case";

const deleteInput = (): DeleteSolicitudAdjuntoInput => ({
  solicitudId: "sol-1",
  adjuntoId: "adj-1",
  deletedBy: "user-1",
  currentUser: {
    id: "user-1",
    workflowOwnerId: "owner-1",
  },
  workflowOwnerId: "owner-1",
  deleteReason: "Documento reemplazado",
});

describe("DeleteSolicitudAdjuntoUseCase", () => {
  it("soft deletes an adjunto and records audit metadata", async () => {
    let receivedSoftDelete:
      | Parameters<SolicitudAdjuntoRepository["softDelete"]>[0]
      | null = null;
    const deletedAt = new Date("2026-05-13T10:00:00.000Z");
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
      findById: async () => storedAdjunto(),
      listBySolicitudId: async () => [],
      softDelete: async (input) => {
        receivedSoftDelete = input;
        return {
          ...storedAdjunto(),
          deletedAt: input.deletedAt,
          deletedBy: input.deletedBy,
          deleteReason: input.deleteReason,
        };
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new DeleteSolicitudAdjuntoUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => deletedAt,
      repository,
      solicitudesRepository,
    });

    const result = await useCase.execute(deleteInput());

    assert.equal(result.deletedAt?.toISOString(), deletedAt.toISOString());
    assert.equal(result.deletedBy, "user-1");
    assert.equal(result.deleteReason, "Documento reemplazado");
    assert.deepEqual(receivedSoftDelete, {
      adjuntoId: "adj-1",
      deletedAt,
      deletedBy: "user-1",
      deleteReason: "Documento reemplazado",
    });
  });

  it("allows delete when current owner matches even outside CargaVendedor", async () => {
    const useCase = new DeleteSolicitudAdjuntoUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => storedAdjunto(),
        listBySolicitudId: async () => [],
        softDelete: async (input) => ({
          ...storedAdjunto(),
          deletedAt: input.deletedAt,
          deletedBy: input.deletedBy,
          deleteReason: input.deleteReason,
        }),
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
            createdBy: "creator-1",
            estadoActual: {
              code: "Confirmada",
              id: "state-2",
              name: "Confirmada",
              ownerId: "owner-riesgo",
            },
            participants: [],
          }),
        listByOwner: async () => [],
        update: async () => {
          throw new Error("not used");
        },
      },
    });

    const result = await useCase.execute({
      adjuntoId: "adj-1",
      currentUser: {
        id: "operator-riesgo",
        workflowOwnerId: "owner-riesgo",
      },
      deletedBy: "operator-riesgo",
      solicitudId: "sol-1",
      workflowOwnerId: "owner-riesgo",
    });

    assert.equal(result.deletedBy, "operator-riesgo");
  });

  it("does not allow a participant outside the current owner to delete adjuntos", async () => {
    const useCase = new DeleteSolicitudAdjuntoUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => storedAdjunto(),
        listBySolicitudId: async () => [],
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
            createdBy: "creator-1",
            estadoActual: {
              code: "CargaVendedor",
              id: "state-1",
              name: "Carga vendedor",
              ownerId: "owner-2",
            },
            participants: [{ userId: "participant-1" }],
          }),
        listByOwner: async () => [],
        update: async () => {
          throw new Error("not used");
        },
      },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          adjuntoId: "adj-1",
          currentUser: {
            id: "participant-1",
            workflowOwnerId: "owner-1",
          },
          deletedBy: "participant-1",
          deleteReason: "Documento reemplazado",
          solicitudId: "sol-1",
          workflowOwnerId: "owner-1",
        }),
      ForbiddenSolicitudAdjuntoAccessError,
    );
  });

  it("rejects delete when the adjunto belongs to another solicitud", async () => {
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
      findById: async () => storedAdjunto({ solicitudId: "sol-2" }),
      listBySolicitudId: async () => [],
      softDelete: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new DeleteSolicitudAdjuntoUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      repository,
      solicitudesRepository,
    });

    await assert.rejects(
      () => useCase.execute(deleteInput()),
      SolicitudAdjuntoNotFoundError,
    );
  });

  it("rejects delete when the parent solicitud belongs to another user", async () => {
    const useCase = new DeleteSolicitudAdjuntoUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => storedAdjunto(),
        listBySolicitudId: async () => [],
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
        findById: async () => ownedSolicitud({ estadoActual: { code: "CargaVendedor", id: "state-1", name: "Carga vendedor", ownerId: "owner-2" } }),
        listByOwner: async () => [],
        update: async () => {
          throw new Error("not used");
        },
      },
    });

    await assert.rejects(
      () => useCase.execute(deleteInput()),
      ForbiddenSolicitudAdjuntoAccessError,
    );
  });

  it("rejects delete when parent solicitud does not exist", async () => {
    const useCase = new DeleteSolicitudAdjuntoUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => storedAdjunto(),
        listBySolicitudId: async () => [],
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
      () => useCase.execute(deleteInput()),
      SolicitudAdjuntoNotFoundError,
    );
  });

  it("rejects delete when the field access rule is missing, inactive or attachment management is disabled", async () => {
    for (const rule of [
      null,
      fieldAccessRule({ active: false }),
      fieldAccessRule({ canManageAttachments: false }),
    ]) {
      const useCase = new DeleteSolicitudAdjuntoUseCase({
        fieldAccessRulesRepository: createFieldAccessRulesRepository(rule),
        now: () => new Date("2026-05-13T10:00:00.000Z"),
        repository: {
          create: async () => {
            throw new Error("not used");
          },
          createMany: async () => {
            throw new Error("not used");
          },
          findById: async () => storedAdjunto(),
          listBySolicitudId: async () => [],
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
          findById: async () => ownedSolicitud(),
          listByOwner: async () => [],
          update: async () => {
            throw new Error("not used");
          },
        },
      });

      await assert.rejects(
        () => useCase.execute(deleteInput()),
        ForbiddenSolicitudAdjuntoAccessError,
      );
    }
  });
});

function createFieldAccessRulesRepository(
  rule: ReturnType<typeof fieldAccessRule> | null = fieldAccessRule(),
): SolicitudFieldAccessRulesRepository {
  return {
    findByWorkflowStateId: async () => rule,
    findByWorkflowStateIds: async () => (rule ? [rule] : []),
  };
}

function fieldAccessRule(overrides?: {
  active?: boolean;
  canManageAttachments?: boolean;
}) {
  return {
    active: overrides?.active ?? true,
    backgroundColor: null,
    canManageAttachments: overrides?.canManageAttachments ?? true,
    defaultMode: "readonly" as const,
    editableFields: [],
    editableGroups: [],
    readonlyReason: null,
    textColor: null,
    workflowStateId: "state-1",
  };
}
