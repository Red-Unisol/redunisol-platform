import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UploadSolicitudAdjuntosBatchInput } from "./UploadSolicitudAdjuntosBatch.use-case";
import type { SolicitudAdjuntoRepository } from "../../domain/repositories/SolicitudAdjuntoRepository";
import type { AdjuntosObjectStorage } from "../../domain/services/AdjuntosObjectStorage";
import {
  ForbiddenSolicitudAdjuntoAccessError,
  SolicitudAdjuntoNotFoundError,
  SolicitudAdjuntoStorageUnavailableError,
  SolicitudAdjuntoUploadNotAllowedError,
} from "../../domain/solicitudes-adjuntos-errors";
import type { SolicitudFieldAccessRulesRepository } from "../../../domain/repositories/SolicitudFieldAccessRulesRepository";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { ownedSolicitud, storedAdjunto } from "./AdjuntosUseCaseTest.fixtures";
import { UploadSolicitudAdjuntosBatchUseCase } from "./UploadSolicitudAdjuntosBatch.use-case";

function batchInput(
  overrides?: Partial<UploadSolicitudAdjuntosBatchInput>,
): UploadSolicitudAdjuntosBatchInput {
  return {
    solicitudId: "sol-1",
    createdBy: "user-1",
    currentUser: {
      id: "user-1",
      workflowOwnerId: "owner-1",
    },
    workflowOwnerId: "owner-1",
    files: [
      {
        file: {
          buffer: Buffer.from("dni"),
          fileName: "dni.pdf",
          mimeType: "application/pdf",
          size: 3,
        },
        tipoAdjunto: "DNI",
      },
      {
        file: {
          buffer: Buffer.from("firma"),
          fileName: "firma.pdf",
          mimeType: "application/pdf",
          size: 5,
        },
        tipoAdjunto: "Documentación Adicional",
      },
    ],
    ...overrides,
  };
}

function fieldAccessRulesRepository(
  rule: { active: boolean; canManageAttachments: boolean } | null = {
    active: true,
    canManageAttachments: true,
  },
): SolicitudFieldAccessRulesRepository {
  return {
    findByWorkflowStateId: async () =>
      rule && {
        active: rule.active,
        backgroundColor: null,
        canManageAttachments: rule.canManageAttachments,
        defaultMode: "readonly" as const,
        editableFields: [],
        editableGroups: [],
        readonlyReason: null,
        textColor: null,
        workflowStateId: "state-1",
      },
    findByWorkflowStateIds: async () => [],
  };
}

function solicitudesRepository(
  solicitud: ReturnType<typeof ownedSolicitud> | null = ownedSolicitud(),
): SolicitudesCoreRepository {
  return {
    create: async () => {
      throw new Error("not used");
    },
    findById: async () => solicitud,
    listByOwner: async () => [],
    update: async () => {
      throw new Error("not used");
    },
  };
}

describe("UploadSolicitudAdjuntosBatchUseCase", () => {
  it("uploads and persists every file in a valid batch", async () => {
    const uploadedObjects: Parameters<AdjuntosObjectStorage["uploadObject"]>[0][] =
      [];
    const createManyInputs: unknown[] = [];
    const objectStorage: AdjuntosObjectStorage = {
      deleteObject: async () => {
        throw new Error("not used");
      },
      getObjectStream: async () => {
        throw new Error("not used");
      },
      uploadObject: async (input) => {
        uploadedObjects.push(input);
      },
    };
    const repository: SolicitudAdjuntoRepository = {
      create: async () => {
        throw new Error("not used");
      },
      createMany: async (inputs) => {
        createManyInputs.push(...inputs);

        return inputs.map((input, index) => ({
          ...storedAdjunto(),
          id: input.adjuntoId,
          tipoAdjunto: input.tipoAdjunto,
          archivoNombre: input.archivoNombre,
          uploadedBy: input.uploadedBy,
          ...(index === 1 ? { archivoNombre: "firma.pdf" } : {}),
        }));
      },
      findById: async () => null,
      listBySolicitudId: async () => [],
      softDelete: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new UploadSolicitudAdjuntosBatchUseCase({
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      fieldAccessRulesRepository: fieldAccessRulesRepository(),
      maxFileSizeBytes: 1024,
      objectStorage,
      repository,
      solicitudesRepository: solicitudesRepository(),
      storageBucket: "solicitudes",
    });

    const result = await useCase.execute(batchInput());

    assert.equal(uploadedObjects.length, 2);
    assert.equal(createManyInputs.length, 2);
    assert.equal(result.length, 2);
  });

  it("rejects the whole batch without uploading anything when a tipoAdjunto is not in the catalog", async () => {
    const uploadedObjects: unknown[] = [];
    const useCase = new UploadSolicitudAdjuntosBatchUseCase({
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      fieldAccessRulesRepository: fieldAccessRulesRepository(),
      maxFileSizeBytes: 1024,
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => {
          throw new Error("not used");
        },
        uploadObject: async (input) => {
          uploadedObjects.push(input);
        },
      },
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        listBySolicitudId: async () => [],
        softDelete: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: solicitudesRepository(),
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () =>
        useCase.execute(
          batchInput({
            files: [
              {
                file: {
                  buffer: Buffer.from("dni"),
                  fileName: "dni.pdf",
                  mimeType: "application/pdf",
                  size: 3,
                },
                tipoAdjunto: "Tipo Inexistente",
              },
            ],
          }),
        ),
      SolicitudAdjuntoUploadNotAllowedError,
    );
    assert.equal(uploadedObjects.length, 0);
  });

  it("rejects an empty batch", async () => {
    const useCase = new UploadSolicitudAdjuntosBatchUseCase({
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      fieldAccessRulesRepository: fieldAccessRulesRepository(),
      maxFileSizeBytes: 1024,
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => {
          throw new Error("not used");
        },
        uploadObject: async () => {
          throw new Error("not used");
        },
      },
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        listBySolicitudId: async () => [],
        softDelete: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: solicitudesRepository(),
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () => useCase.execute(batchInput({ files: [] })),
      SolicitudAdjuntoUploadNotAllowedError,
    );
  });

  it("rejects a batch of more than 10 files", async () => {
    const useCase = new UploadSolicitudAdjuntosBatchUseCase({
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      fieldAccessRulesRepository: fieldAccessRulesRepository(),
      maxFileSizeBytes: 1024,
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => {
          throw new Error("not used");
        },
        uploadObject: async () => {
          throw new Error("not used");
        },
      },
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        listBySolicitudId: async () => [],
        softDelete: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: solicitudesRepository(),
      storageBucket: "solicitudes",
    });
    const elevenFiles = Array.from({ length: 11 }, (_, index) => ({
      file: {
        buffer: Buffer.from("x"),
        fileName: `file-${index}.pdf`,
        mimeType: "application/pdf",
        size: 1,
      },
      tipoAdjunto: "DNI",
    }));

    await assert.rejects(
      () => useCase.execute(batchInput({ files: elevenFiles })),
      SolicitudAdjuntoUploadNotAllowedError,
    );
  });

  it("deletes already-uploaded objects and maps the error when storage fails partway through the batch", async () => {
    const uploadedObjects: Parameters<AdjuntosObjectStorage["uploadObject"]>[0][] =
      [];
    const deletedObjects: Parameters<AdjuntosObjectStorage["deleteObject"]>[0][] =
      [];
    let uploadCallCount = 0;
    const useCase = new UploadSolicitudAdjuntosBatchUseCase({
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      fieldAccessRulesRepository: fieldAccessRulesRepository(),
      maxFileSizeBytes: 1024,
      objectStorage: {
        deleteObject: async (input) => {
          deletedObjects.push(input);
        },
        getObjectStream: async () => {
          throw new Error("not used");
        },
        uploadObject: async (input) => {
          uploadCallCount += 1;

          if (uploadCallCount === 2) {
            throw new Error("minio down");
          }

          uploadedObjects.push(input);
        },
      },
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        listBySolicitudId: async () => [],
        softDelete: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: solicitudesRepository(),
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () => useCase.execute(batchInput()),
      SolicitudAdjuntoStorageUnavailableError,
    );
    assert.equal(uploadedObjects.length, 1);
    assert.equal(deletedObjects.length, 1);
  });

  it("deletes all uploaded objects and rethrows the original error when persistence fails", async () => {
    const deletedObjects: Parameters<AdjuntosObjectStorage["deleteObject"]>[0][] =
      [];
    const useCase = new UploadSolicitudAdjuntosBatchUseCase({
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      fieldAccessRulesRepository: fieldAccessRulesRepository(),
      maxFileSizeBytes: 1024,
      objectStorage: {
        deleteObject: async (input) => {
          deletedObjects.push(input);
        },
        getObjectStream: async () => {
          throw new Error("not used");
        },
        uploadObject: async () => {
          // no-op, succeeds
        },
      },
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("db persistence failed");
        },
        findById: async () => null,
        listBySolicitudId: async () => [],
        softDelete: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: solicitudesRepository(),
      storageBucket: "solicitudes",
    });

    await assert.rejects(() => useCase.execute(batchInput()), /db persistence failed/);
    assert.equal(deletedObjects.length, 2);
  });

  it("rejects when the current user cannot manage attachments for the solicitud", async () => {
    const useCase = new UploadSolicitudAdjuntosBatchUseCase({
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      fieldAccessRulesRepository: fieldAccessRulesRepository({
        active: true,
        canManageAttachments: false,
      }),
      maxFileSizeBytes: 1024,
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => {
          throw new Error("not used");
        },
        uploadObject: async () => {
          throw new Error("not used");
        },
      },
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        listBySolicitudId: async () => [],
        softDelete: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: solicitudesRepository(),
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () => useCase.execute(batchInput()),
      ForbiddenSolicitudAdjuntoAccessError,
    );
  });

  it("rejects when the parent solicitud does not exist", async () => {
    const useCase = new UploadSolicitudAdjuntosBatchUseCase({
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      fieldAccessRulesRepository: fieldAccessRulesRepository(),
      maxFileSizeBytes: 1024,
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => {
          throw new Error("not used");
        },
        uploadObject: async () => {
          throw new Error("not used");
        },
      },
      repository: {
        create: async () => {
          throw new Error("not used");
        },
        createMany: async () => {
          throw new Error("not used");
        },
        findById: async () => null,
        listBySolicitudId: async () => [],
        softDelete: async () => {
          throw new Error("not used");
        },
        update: async () => {
          throw new Error("not used");
        },
      },
      solicitudesRepository: solicitudesRepository(null),
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () => useCase.execute(batchInput()),
      SolicitudAdjuntoNotFoundError,
    );
  });
});
