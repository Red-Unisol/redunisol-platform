import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UploadSolicitudAdjuntoInput } from "../dtos/UploadSolicitudAdjunto.dto";
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
import { UploadSolicitudAdjuntoUseCase } from "./UploadSolicitudAdjunto.use-case";

const uploadInput = (
  overrides?: Partial<UploadSolicitudAdjuntoInput>,
): UploadSolicitudAdjuntoInput => ({
  solicitudId: "sol-1",
  createdBy: "user-1",
  currentUser: {
    id: "user-1",
    workflowOwnerId: "owner-1",
  },
  workflowOwnerId: "owner-1",
  descripcion: "Documento nacional de identidad",
  adicional: "Frente",
  comentario: "DNI frente",
  nroDocumento: "33344455",
  restringido: true,
  file: {
    buffer: Buffer.from("pdf"),
    fileName: "dni.pdf",
    mimeType: "application/pdf",
    size: 3,
  },
  tipoAdjunto: "DNI",
  ...overrides,
});

describe("UploadSolicitudAdjuntoUseCase", () => {
  it("uploads a pdf adjunto for an owned solicitud in CargaVendedor", async () => {
    const uploadedObjects: Parameters<AdjuntosObjectStorage["uploadObject"]>[0][] =
      [];
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
      create: async (input) => ({
        ...storedAdjunto({
          archivoPath: "solicitudes/sol-1/adjuntos/generated.pdf",
        }),
        id: input.adjuntoId,
        archivoNombre: input.archivoNombre,
        archivoPath: input.archivoPath,
        archivoMimeType: input.archivoMimeType,
        archivoSizeBytes: input.archivoSizeBytes,
        storageBucket: input.storageBucket,
        tipoAdjunto: input.tipoAdjunto,
        estadoAdjunto: input.estadoAdjunto,
        descripcion: input.descripcion,
        adicional: input.adicional,
        comentario: input.comentario,
        nroDocumento: input.nroDocumento,
        restringido: input.restringido,
        uploadedBy: input.uploadedBy,
      }),
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
    };
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
    const useCase = new UploadSolicitudAdjuntoUseCase({
      objectStorage,
      repository,
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      solicitudesRepository,
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 1024,
      storageBucket: "solicitudes",
    });

    const created = await useCase.execute(uploadInput());

    assert.equal(uploadedObjects.length, 1);
    assert.equal(uploadedObjects[0]?.bucket, "solicitudes");
    assert.equal(uploadedObjects[0]?.contentType, "application/pdf");
    assert.match(
      uploadedObjects[0]?.key ?? "",
      /^solicitudes\/sol-1\/adjuntos\/.+\.pdf$/,
    );
    assert.equal(created.estadoAdjunto, "Cargado");
    assert.equal(created.tipoAdjunto, "DNI");
    assert.equal(created.descripcion, "Documento nacional de identidad");
    assert.equal(created.adicional, "Frente");
    assert.equal(created.comentario, "DNI frente");
    assert.equal(created.nroDocumento, "33344455");
    assert.equal(created.restringido, true);
  });

  it("allows upload for current owner user even when not creator and not participant", async () => {
    const useCase = new UploadSolicitudAdjuntoUseCase({
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => {
          throw new Error("not used");
        },
        uploadObject: async () => {
          // no-op
        },
      },
      repository: {
        create: async (input) => ({
          ...storedAdjunto(),
          id: input.adjuntoId,
          uploadedBy: input.uploadedBy,
        }),
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
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      solicitudesRepository: {
        create: async () => {
          throw new Error("not used");
        },
        findById: async () =>
          ownedSolicitud({
            createdBy: "creator-1",
            participants: [],
          }),
        listByOwner: async () => [],
        update: async () => {
          throw new Error("not used");
        },
      },
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 1024,
      storageBucket: "solicitudes",
    });

    const result = await useCase.execute(
      uploadInput({
        createdBy: "operator-1",
        currentUser: {
          id: "operator-1",
          workflowOwnerId: "owner-1",
        },
      }),
    );

    assert.equal(result.uploadedBy, "operator-1");
  });

  it("does not allow a participant outside the current owner to upload adjuntos", async () => {
    const useCase = new UploadSolicitudAdjuntoUseCase({
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
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 1024,
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () =>
        useCase.execute(
          uploadInput({
            createdBy: "participant-1",
            currentUser: {
              id: "participant-1",
              workflowOwnerId: "owner-1",
            },
          }),
        ),
      ForbiddenSolicitudAdjuntoAccessError,
    );
  });

  it("deletes the uploaded object when persistence fails after upload", async () => {
    const uploadedObjects: Parameters<AdjuntosObjectStorage["uploadObject"]>[0][] =
      [];
    const deletedObjects: Parameters<AdjuntosObjectStorage["deleteObject"]>[0][] =
      [];
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
        throw new Error("db persistence failed");
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
    };
    const objectStorage: AdjuntosObjectStorage = {
      deleteObject: async (input) => {
        deletedObjects.push(input);
      },
      getObjectStream: async () => {
        throw new Error("not used");
      },
      uploadObject: async (input) => {
        uploadedObjects.push(input);
      },
    };
    const useCase = new UploadSolicitudAdjuntoUseCase({
      objectStorage,
      repository,
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      solicitudesRepository,
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 1024,
      storageBucket: "solicitudes",
    });

    await assert.rejects(() => useCase.execute(uploadInput()), /db persistence failed/);

    assert.equal(uploadedObjects.length, 1);
    assert.deepEqual(deletedObjects, [
      {
        bucket: uploadedObjects[0]?.bucket ?? "",
        key: uploadedObjects[0]?.key ?? "",
      },
    ]);
  });

  it("rejects upload when the solicitud belongs to another user", async () => {
    const solicitudesRepository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () =>
        ownedSolicitud({
          estadoActual: {
            code: "CargaVendedor",
            id: "state-1",
            name: "Carga vendedor",
            ownerId: "owner-2",
          },
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
      listBySolicitudId: async () => [],
      softDelete: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const objectStorage: AdjuntosObjectStorage = {
      deleteObject: async () => {
        throw new Error("not used");
      },
      getObjectStream: async () => {
        throw new Error("not used");
      },
      uploadObject: async () => {
        throw new Error("not used");
      },
    };

    const useCase = new UploadSolicitudAdjuntoUseCase({
      objectStorage,
      repository,
      fieldAccessRulesRepository: createFieldAccessRulesRepository(null),
      solicitudesRepository,
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 1024,
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () => useCase.execute(uploadInput()),
      ForbiddenSolicitudAdjuntoAccessError,
    );
  });

  it("allows upload when current owner matches even if state is not CargaVendedor", async () => {
    const uploadedObjects: Parameters<AdjuntosObjectStorage["uploadObject"]>[0][] =
      [];
    const solicitudesRepository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      findById: async () =>
        ownedSolicitud({
          estadoActual: {
            code: "Confirmada",
            id: "state-2",
            name: "Confirmada",
            ownerId: "owner-1",
          },
        }),
      listByOwner: async () => [],
      update: async () => {
        throw new Error("not used");
      },
    };
    const repository: SolicitudAdjuntoRepository = {
      create: async (input) => ({
        ...storedAdjunto({
          archivoPath: "solicitudes/sol-1/adjuntos/generated.pdf",
        }),
        id: input.adjuntoId,
        archivoNombre: input.archivoNombre,
        archivoPath: input.archivoPath,
        archivoMimeType: input.archivoMimeType,
        archivoSizeBytes: input.archivoSizeBytes,
        storageBucket: input.storageBucket,
        tipoAdjunto: input.tipoAdjunto,
        estadoAdjunto: input.estadoAdjunto,
        descripcion: input.descripcion,
        adicional: input.adicional,
        comentario: input.comentario,
        nroDocumento: input.nroDocumento,
        restringido: input.restringido,
        uploadedBy: input.uploadedBy,
      }),
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
    };
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

    const useCase = new UploadSolicitudAdjuntoUseCase({
      objectStorage,
      repository,
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      solicitudesRepository,
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 1024,
      storageBucket: "solicitudes",
    });

    const created = await useCase.execute(uploadInput());

    assert.equal(uploadedObjects.length, 1);
    assert.equal(created.tipoAdjunto, "DNI");
    assert.equal(created.estadoAdjunto, "Cargado");
  });

  it("maps storage upload failures to storage unavailable", async () => {
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

    const useCase = new UploadSolicitudAdjuntoUseCase({
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => {
          throw new Error("not used");
        },
        uploadObject: async () => {
          throw new Error("minio down");
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
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
      solicitudesRepository,
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 1024,
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () => useCase.execute(uploadInput()),
      SolicitudAdjuntoStorageUnavailableError,
    );
  });

  it("returns a specific error when the file extension is not allowed", async () => {
    const useCase = new UploadSolicitudAdjuntoUseCase({
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
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 1024,
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () =>
        useCase.execute(
          uploadInput({
            file: {
              buffer: Buffer.from("exe"),
              fileName: "dni.exe",
              mimeType: "application/pdf",
              size: 3,
            },
          }),
        ),
      (error) => {
        assert.ok(error instanceof SolicitudAdjuntoUploadNotAllowedError);
        assert.equal(
          error.message,
          "La extensión del archivo no está permitida para adjuntos de la solicitud.",
        );
        return true;
      },
    );
  });

  it("returns a specific error when the file mime type is not allowed", async () => {
    const useCase = new UploadSolicitudAdjuntoUseCase({
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
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 1024,
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () =>
        useCase.execute(
          uploadInput({
            file: {
              buffer: Buffer.from("pdf"),
              fileName: "dni.pdf",
              mimeType: "application/x-msdownload",
              size: 3,
            },
          }),
        ),
      (error) => {
        assert.ok(error instanceof SolicitudAdjuntoUploadNotAllowedError);
        assert.equal(
          error.message,
          "El tipo de archivo no está permitido para adjuntos de la solicitud.",
        );
        return true;
      },
    );
  });

  it("returns a specific error when the file exceeds the maximum allowed size", async () => {
    const useCase = new UploadSolicitudAdjuntoUseCase({
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
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 3,
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () =>
        useCase.execute(
          uploadInput({
            file: {
              buffer: Buffer.from("large"),
              fileName: "dni.pdf",
              mimeType: "application/pdf",
              size: 4,
            },
          }),
        ),
      (error) => {
        assert.ok(error instanceof SolicitudAdjuntoUploadNotAllowedError);
        assert.equal(
          error.message,
          "El archivo supera el tamaño máximo permitido para adjuntos de la solicitud.",
        );
        return true;
      },
    );
  });

  it("rejects upload when parent solicitud does not exist", async () => {
    const useCase = new UploadSolicitudAdjuntoUseCase({
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
      fieldAccessRulesRepository: createFieldAccessRulesRepository(),
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
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 1024,
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () => useCase.execute(uploadInput()),
      SolicitudAdjuntoNotFoundError,
    );
  });

  it("rejects upload when the field access rule is missing for the current state", async () => {
    const useCase = new UploadSolicitudAdjuntoUseCase({
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      fieldAccessRulesRepository: createFieldAccessRulesRepository(null),
      maxFileSizeBytes: 1024,
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => {
          throw new Error("not used");
        },
        uploadObject: async () => {
          // no-op
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
      storageBucket: "solicitudes",
    });

    await assert.rejects(
      () => useCase.execute(uploadInput()),
      ForbiddenSolicitudAdjuntoAccessError,
    );
  });

  it("rejects upload when the field access rule is inactive or attachment management is disabled", async () => {
    for (const rule of [
      fieldAccessRule({ active: false }),
      fieldAccessRule({ canManageAttachments: false }),
    ]) {
      const useCase = new UploadSolicitudAdjuntoUseCase({
        allowedExtensions: [".pdf"],
        allowedMimeTypes: ["application/pdf"],
        fieldAccessRulesRepository: createFieldAccessRulesRepository(rule),
        maxFileSizeBytes: 1024,
        objectStorage: {
          deleteObject: async () => {
            throw new Error("not used");
          },
          getObjectStream: async () => {
            throw new Error("not used");
          },
          uploadObject: async () => {
            // no-op
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
        storageBucket: "solicitudes",
      });

      await assert.rejects(
        () => useCase.execute(uploadInput()),
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
