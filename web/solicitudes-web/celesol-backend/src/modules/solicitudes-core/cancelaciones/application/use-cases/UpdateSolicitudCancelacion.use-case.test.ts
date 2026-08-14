import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UpdateSolicitudCancelacionInput } from "../dtos/UpdateSolicitudCancelacion.dto";
import type { SolicitudCancelacionRepository } from "../../domain/repositories/SolicitudCancelacionRepository";
import {
  ForbiddenSolicitudCancelacionAccessError,
  SolicitudCancelacionNotFoundError,
} from "../../domain/solicitudes-cancelaciones-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { ownedSolicitud, storedCancelacion } from "./CancelacionesUseCaseTest.fixtures";
import { UpdateSolicitudCancelacionUseCase } from "./UpdateSolicitudCancelacion.use-case";

const updateInput = (): UpdateSolicitudCancelacionInput => ({
  solicitudId: "sol-1",
  cancelacionId: "canc-1",
  currentUser: {
    id: "user-1",
    workflowOwnerId: "owner-1",
  },
  workflowOwnerId: "owner-1",
  monto: 20000,
  notas: "Monto actualizado",
});

describe("UpdateSolicitudCancelacionUseCase", () => {
  it("updates a cancelacion when the current owner can manage attachments", async () => {
    let receivedUpdate:
      | Parameters<SolicitudCancelacionRepository["update"]>[0]
      | null = null;
    const useCase = new UpdateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
        update: async (input) => {
          receivedUpdate = input;

          return storedCancelacion({ monto: input.monto ?? 15000 });
        },
      },
      solicitudesRepository: createSolicitudesRepository(),
    });

    const result = await useCase.execute(updateInput());

    assert.equal(result.monto, 20000);
    assert.deepEqual(receivedUpdate, {
      cancelacionId: "canc-1",
      cbu: undefined,
      cuentaADebitar: undefined,
      cuentaBancaria: undefined,
      monto: 20000,
      notas: "Monto actualizado",
      socio: undefined,
      socioLegacyId: undefined,
    });
  });

  it("rejects when the current user is not the owner of the solicitud", async () => {
    const useCase = new UpdateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
          ...updateInput(),
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
      const useCase = new UpdateSolicitudCancelacionUseCase({
        fieldAccessRulesRepository: createFieldAccessRulesRepository(rule),
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
        () => useCase.execute(updateInput()),
        ForbiddenSolicitudCancelacionAccessError,
      );
    }
  });

  it("rejects when the solicitud does not exist", async () => {
    const useCase = new UpdateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
      () => useCase.execute(updateInput()),
      SolicitudCancelacionNotFoundError,
    );
  });

  it("rejects when the cancelacion does not exist", async () => {
    const useCase = new UpdateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
      () => useCase.execute(updateInput()),
      SolicitudCancelacionNotFoundError,
    );
  });

  it("rejects when the cancelacion belongs to another solicitud", async () => {
    const useCase = new UpdateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
      () => useCase.execute(updateInput()),
      SolicitudCancelacionNotFoundError,
    );
  });

  it("rejects when the cancelacion is already soft deleted", async () => {
    const useCase = new UpdateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () =>
          storedCancelacion({ deletedAt: new Date("2026-05-13T10:00:00.000Z") }),
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
      () => useCase.execute(updateInput()),
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
