import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CreateSolicitudCancelacionInput } from "../dtos/CreateSolicitudCancelacion.dto";
import type { SolicitudCancelacionRepository } from "../../domain/repositories/SolicitudCancelacionRepository";
import {
  ForbiddenSolicitudCancelacionAccessError,
  SolicitudCancelacionNotFoundError,
} from "../../domain/solicitudes-cancelaciones-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { ownedSolicitud, storedCancelacion } from "./CancelacionesUseCaseTest.fixtures";
import { CreateSolicitudCancelacionUseCase } from "./CreateSolicitudCancelacion.use-case";

const createInput = (): CreateSolicitudCancelacionInput => ({
  solicitudId: "sol-1",
  createdBy: "user-1",
  currentUser: {
    id: "user-1",
    workflowOwnerId: "owner-1",
  },
  workflowOwnerId: "owner-1",
  cuentaADebitar: "1234567890",
  cbu: "0000003100012345678901",
  cuentaBancaria: "Caja de Ahorro",
  socio: "Juan Perez",
  socioLegacyId: "SOC-1",
  monto: 15000,
  notas: "Cancelacion parcial",
});

describe("CreateSolicitudCancelacionUseCase", () => {
  it("creates a cancelacion when the current owner can manage attachments", async () => {
    let receivedRecord: Parameters<SolicitudCancelacionRepository["create"]>[0] | undefined;
    const repository: SolicitudCancelacionRepository = {
      create: async (input) => {
        receivedRecord = input;

        return storedCancelacion();
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
    };
    const useCase = new CreateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      repository,
      solicitudesRepository: createSolicitudesRepository(),
    });

    const result = await useCase.execute(createInput());

    assert.equal(result.id, "canc-1");
    assert.equal(receivedRecord?.solicitudId, "sol-1");
    assert.equal(receivedRecord?.cbu, "0000003100012345678901");
    assert.equal(receivedRecord?.createdBy, "user-1");
    assert.equal(receivedRecord?.socioLegacyId, "SOC-1");
    assert.equal(typeof receivedRecord?.cancelacionId, "string");
  });

  it("defaults optional notas and socioLegacyId to null", async () => {
    let receivedRecord: Parameters<SolicitudCancelacionRepository["create"]>[0] | undefined;
    const useCase = new CreateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      repository: {
        create: async (input) => {
          receivedRecord = input;

          return storedCancelacion();
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
      solicitudesRepository: createSolicitudesRepository(),
    });

    await useCase.execute({
      ...createInput(),
      notas: undefined,
      socioLegacyId: undefined,
    });

    assert.equal(receivedRecord?.notas, null);
    assert.equal(receivedRecord?.socioLegacyId, null);
  });

  it("rejects when the current user is not the owner of the solicitud", async () => {
    const useCase = new CreateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
      solicitudesRepository: createSolicitudesRepository(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          ...createInput(),
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
      const useCase = new CreateSolicitudCancelacionUseCase({
        fieldAccessRulesRepository: createFieldAccessRulesRepository(rule),
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
        solicitudesRepository: createSolicitudesRepository(),
      });

      await assert.rejects(
        () => useCase.execute(createInput()),
        ForbiddenSolicitudCancelacionAccessError,
      );
    }
  });

  it("rejects when the solicitud does not exist", async () => {
    const useCase = new CreateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
      () => useCase.execute(createInput()),
      SolicitudCancelacionNotFoundError,
    );
  });

  it("allows a system admin to create a cancelacion regardless of ownership", async () => {
    const useCase = new CreateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      repository: {
        create: async () => storedCancelacion(),
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
      solicitudesRepository: createSolicitudesRepository(),
    });

    const result = await useCase.execute({
      ...createInput(),
      currentUser: { id: "admin-1", isSystemAdmin: true, workflowOwnerId: null },
      workflowOwnerId: "",
    });

    assert.equal(result.id, "canc-1");
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
