import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

import type { DownloadSolicitudAdjuntoInput } from "../dtos/DownloadSolicitudAdjunto.dto";
import type { SolicitudAdjuntoRepository } from "../../domain/repositories/SolicitudAdjuntoRepository";
import type { AdjuntosObjectStorage } from "../../domain/services/AdjuntosObjectStorage";
import {
  ForbiddenSolicitudAdjuntoAccessError,
  SolicitudAdjuntoNotFoundError,
  SolicitudAdjuntoStorageUnavailableError,
} from "../../domain/solicitudes-adjuntos-errors";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import { ownedSolicitud, storedAdjunto } from "./AdjuntosUseCaseTest.fixtures";
import { DownloadSolicitudAdjuntoUseCase } from "./DownloadSolicitudAdjunto.use-case";

const downloadInput = (): DownloadSolicitudAdjuntoInput => ({
  solicitudId: "sol-1",
  adjuntoId: "adj-1",
  currentUser: {
    id: "user-1",
    workflowOwnerId: "owner-1",
  },
  workflowOwnerId: "owner-1",
});

it("the generic download cannot bypass generated review evidence permissions", async () => {
  for (const role of ["VENDEDORES", "RIESGO", "TESORERIA", "LEGAJOS_DIGITALES", "ADMIN"]) {
    let streamed = false;
    const uc = new DownloadSolicitudAdjuntoUseCase({
      repository: { findById: async () => storedAdjunto({ tipoAdjunto: "Legajo Digital", archivoPath: "solicitudes/sol-1/revision-documental/review/legajo.pdf" }) } as unknown as SolicitudAdjuntoRepository,
      solicitudesRepository: {
        findById: async () => ownedSolicitud(),
        findWorkflowOwnerCodeById: async (id: string) => { assert.equal(id, "owner-1"); return role; },
      } as unknown as SolicitudesCoreRepository,
      objectStorage: { getObjectStream: async () => { streamed = true; return new PassThrough(); } } as unknown as AdjuntosObjectStorage,
    });
    const input = downloadInput();
    if (role === "ADMIN") input.currentUser.isSystemAdmin = true;
    if (role === "ADMIN" || role === "LEGAJOS_DIGITALES") {
      await uc.execute(input);
      assert.equal(streamed, true);
    } else {
      await assert.rejects(uc.execute(input), ForbiddenSolicitudAdjuntoAccessError);
      assert.equal(streamed, false);
    }
  }
});

it("manual Legajo Digital uploads remain downloadable through the normal attachment permissions", async () => {
  const uc = new DownloadSolicitudAdjuntoUseCase({
    repository: { findById: async () => storedAdjunto({ tipoAdjunto: "Legajo Digital", archivoPath: "solicitudes/sol-1/adjuntos/manual.pdf" }) } as unknown as SolicitudAdjuntoRepository,
    solicitudesRepository: { findById: async () => ownedSolicitud() } as unknown as SolicitudesCoreRepository,
    objectStorage: { getObjectStream: async () => new PassThrough() } as unknown as AdjuntosObjectStorage,
  });
  assert.equal((await uc.execute(downloadInput())).adjunto.tipoAdjunto, "Legajo Digital");
});

describe("DownloadSolicitudAdjuntoUseCase", () => {
  it("returns a readable stream for a valid adjunto", async () => {
    const stream = new PassThrough();
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
      getObjectStream: async () => stream,
      uploadObject: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new DownloadSolicitudAdjuntoUseCase({
      objectStorage,
      repository,
      solicitudesRepository,
    });

    const result = await useCase.execute(downloadInput());

    assert.equal(result.adjunto.id, "adj-1");
    assert.equal(result.stream, stream);
  });

  it("downloads an adjunto for the creator outside the current workflow owner", async () => {
    const stream = new PassThrough();
    const useCase = new DownloadSolicitudAdjuntoUseCase({
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => stream,
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
      },
    });

    const result = await useCase.execute({
      adjuntoId: "adj-1",
      currentUser: {
        id: "creator-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });

    assert.equal(result.stream, stream);
  });

  it("downloads an adjunto for a participant outside the current workflow owner", async () => {
    const stream = new PassThrough();
    const useCase = new DownloadSolicitudAdjuntoUseCase({
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => stream,
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
      },
    });

    const result = await useCase.execute({
      adjuntoId: "adj-1",
      currentUser: {
        id: "participant-1",
        workflowOwnerId: "owner-1",
      },
      solicitudId: "sol-1",
      workflowOwnerId: "owner-1",
    });

    assert.equal(result.stream, stream);
  });

  it("rejects download when the adjunto belongs to another solicitud", async () => {
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
    const useCase = new DownloadSolicitudAdjuntoUseCase({
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
      repository,
      solicitudesRepository,
    });

    await assert.rejects(
      () => useCase.execute(downloadInput()),
      SolicitudAdjuntoNotFoundError,
    );
  });

  it("downloads an adjunto for any authenticated user outside the current owner", async () => {
    const stream = new PassThrough();
    const useCase = new DownloadSolicitudAdjuntoUseCase({
      objectStorage: {
        deleteObject: async () => {
          throw new Error("not used");
        },
        getObjectStream: async () => stream,
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

    const result = await useCase.execute(downloadInput());

    assert.equal(result.adjunto.id, "adj-1");
    assert.equal(result.stream, stream);
  });

  it("maps storage stream failures to storage unavailable", async () => {
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
        throw new Error("minio down");
      },
      uploadObject: async () => {
        throw new Error("not used");
      },
    };
    const useCase = new DownloadSolicitudAdjuntoUseCase({
      objectStorage,
      repository,
      solicitudesRepository,
    });

    await assert.rejects(
      () => useCase.execute(downloadInput()),
      SolicitudAdjuntoStorageUnavailableError,
    );
  });
});
