import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DeleteSolicitudCancelacionInput } from "../dtos/DeleteSolicitudCancelacion.dto";
import type { SolicitudCancelacionRepository } from "../../domain/repositories/SolicitudCancelacionRepository";
import {
  ForbiddenSolicitudCancelacionAccessError,
  SolicitudCancelacionNotFoundError,
} from "../../domain/solicitudes-cancelaciones-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { ownedSolicitud, storedCancelacion } from "./CancelacionesUseCaseTest.fixtures";
import { DeleteSolicitudCancelacionUseCase } from "./DeleteSolicitudCancelacion.use-case";

const deleteInput = (): DeleteSolicitudCancelacionInput => ({
  solicitudId: "sol-1",
  cancelacionId: "canc-1",
  deletedBy: "user-1",
  currentUser: {
    id: "user-1",
    workflowOwnerId: "owner-1",
  },
  workflowOwnerId: "owner-1",
});

describe("DeleteSolicitudCancelacionUseCase", () => {
  it("soft deletes a cancelacion and records audit metadata", async () => {
    let receivedSoftDelete:
      | Parameters<SolicitudCancelacionRepository["softDelete"]>[0]
      | null = null;
    const deletedAt = new Date("2026-05-13T10:00:00.000Z");
    const useCase = new DeleteSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => deletedAt,
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => storedCancelacion(),
        listBySolicitudId: async () => {
          throw new Error("not used");
        },
        softDelete: async (input) => {
          receivedSoftDelete = input;

          return {
            ...storedCancelacion(),
            deletedAt: input.deletedAt,
            deletedBy: input.deletedBy,
          };
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: createSolicitudesRepository(),
    });

    const result = await useCase.execute(deleteInput());

    assert.equal(result.deletedAt?.toISOString(), deletedAt.toISOString());
    assert.equal(result.deletedBy, "user-1");
    assert.deepEqual(receivedSoftDelete, {
      cancelacionId: "canc-1",
      deletedAt,
      deletedBy: "user-1",
    });
  });

  it("rejects when the current user is not the owner of the solicitud", async () => {
    const useCase = new DeleteSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => storedCancelacion(),
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
      solicitudesRepository: createSolicitudesRepository(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          ...deleteInput(),
          currentUser: { id: "user-2", workflowOwnerId: "owner-2" },
          workflowOwnerId: "owner-2",
        }),
      ForbiddenSolicitudCancelacionAccessError,
    );
  });

  it("rejects when the field access rule is missing, inactive or attachment management is disabled", async () => {
    for (const rule of [
      null,
      fieldAccessRule({ active: false }),
      fieldAccessRule({ canManageAttachments: false }),
    ]) {
      const useCase = new DeleteSolicitudCancelacionUseCase({
        fieldAccessRulesRepository: createFieldAccessRulesRepository(rule),
        now: () => new Date("2026-05-13T10:00:00.000Z"),
        repository: {
          create: async () => {
            throw new Error("not used");
          },
          findById: async () => storedCancelacion(),
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
        solicitudesRepository: createSolicitudesRepository(),
      });

      await assert.rejects(
        () => useCase.execute(deleteInput()),
        ForbiddenSolicitudCancelacionAccessError,
      );
    }
  });

  it("rejects when the solicitud does not exist", async () => {
    const useCase = new DeleteSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => storedCancelacion(),
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
      () => useCase.execute(deleteInput()),
      SolicitudCancelacionNotFoundError,
    );
  });

  it("rejects when the cancelacion does not exist", async () => {
    const useCase = new DeleteSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
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
      solicitudesRepository: createSolicitudesRepository(),
    });

    await assert.rejects(
      () => useCase.execute(deleteInput()),
      SolicitudCancelacionNotFoundError,
    );
  });

  it("rejects when the cancelacion belongs to another solicitud", async () => {
    const useCase = new DeleteSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () => storedCancelacion({ solicitudId: "sol-2" }),
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
      solicitudesRepository: createSolicitudesRepository(),
    });

    await assert.rejects(
      () => useCase.execute(deleteInput()),
      SolicitudCancelacionNotFoundError,
    );
  });

  it("rejects when the cancelacion is already soft deleted", async () => {
    const useCase = new DeleteSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () =>
          storedCancelacion({ deletedAt: new Date("2026-05-13T09:00:00.000Z") }),
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
      solicitudesRepository: createSolicitudesRepository(),
    });

    await assert.rejects(
      () => useCase.execute(deleteInput()),
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
