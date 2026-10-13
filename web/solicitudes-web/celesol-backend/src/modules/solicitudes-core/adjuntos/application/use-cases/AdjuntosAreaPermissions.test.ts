import assert from "node:assert/strict";
import { it } from "node:test";
import type { SolicitudesCoreRepository } from "../../../domain/repositories/SolicitudesCoreRepository";
import type {
  SolicitudAdjuntoRepository,
  CreateSolicitudAdjuntoRecord,
} from "../../domain/repositories/SolicitudAdjuntoRepository";
import { ForbiddenSolicitudAdjuntoAccessError } from "../../domain/solicitudes-adjuntos-errors";
import { UploadSolicitudAdjuntoUseCase } from "./UploadSolicitudAdjunto.use-case";
import { UploadSolicitudAdjuntosBatchUseCase } from "./UploadSolicitudAdjuntosBatch.use-case";
import { DeleteSolicitudAdjuntoUseCase } from "./DeleteSolicitudAdjunto.use-case";
import { ownedSolicitud, storedAdjunto } from "./AdjuntosUseCaseTest.fixtures";

for (const code of ["RIESGO", "VENDEDORES", "TESORERIA", "OTRA", null]) {
  it(`valida carga individual, lote y borrado con el área autenticada ${code}`, async () => {
    let uploaded = 0;
    let deleted = 0;
    let lookups = 0;
    const solicitud = ownedSolicitud({
      estadoActual: {
        id: "state",
        code: "Pagada",
        name: "Pagada",
        ownerId: "otra-area",
      },
    });
    const solicitudesRepository: SolicitudesCoreRepository = {
      create: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
      findById: async () => solicitud,
      listByOwner: async () => [],
      findWorkflowOwnerCodeById: async (id) => {
        assert.equal(id, "area-autenticada");
        lookups++;
        return code;
      },
    };
    const map = (input: CreateSolicitudAdjuntoRecord) =>
      storedAdjunto({ ...input, id: input.adjuntoId });
    const repository: SolicitudAdjuntoRepository = {
      create: async (input) => map(input),
      createMany: async (inputs) => inputs.map(map),
      findById: async () => storedAdjunto(),
      listBySolicitudId: async () => [],
      softDelete: async () => {
        deleted++;
        return storedAdjunto();
      },
      update: async () => {
        throw new Error("not used");
      },
    };
    const dependencies = {
      solicitudesRepository,
      repository,
      fieldAccessRulesRepository: {
        findByWorkflowStateId: async () => null,
        findByWorkflowStateIds: async () => [],
      },
      objectStorage: {
        uploadObject: async () => {
          uploaded++;
        },
        deleteObject: async () => {},
        getObjectStream: async () => {
          throw new Error("not used");
        },
      },
      allowedExtensions: [".pdf"],
      allowedMimeTypes: ["application/pdf"],
      maxFileSizeBytes: 100,
      storageBucket: "test",
    };
    const input = {
      solicitudId: "sol-1",
      createdBy: "user-1",
      workflowOwnerId: "area-autenticada",
      currentUser: { id: "user-1", workflowOwnerId: "area-autenticada" },
      tipoAdjunto: "Recibo de Sueldo",
      file: {
        buffer: Buffer.from("pdf"),
        size: 3,
        fileName: "recibo.pdf",
        mimeType: "application/pdf",
      },
    };
    const single = new UploadSolicitudAdjuntoUseCase(dependencies);
    const batch = new UploadSolicitudAdjuntosBatchUseCase(dependencies);
    if (code && ["RIESGO", "VENDEDORES", "TESORERIA"].includes(code)) {
      assert.equal((await single.execute(input)).uploadedBy, "user-1");
      assert.equal(
        (
          await batch.execute({
            ...input,
            files: [{ file: input.file, tipoAdjunto: input.tipoAdjunto }],
          })
        ).length,
        1,
      );
      assert.equal(uploaded, 2);
    } else {
      await assert.rejects(
        () => single.execute(input),
        ForbiddenSolicitudAdjuntoAccessError,
      );
      await assert.rejects(
        () =>
          batch.execute({
            ...input,
            files: [{ file: input.file, tipoAdjunto: input.tipoAdjunto }],
          }),
        ForbiddenSolicitudAdjuntoAccessError,
      );
      assert.equal(uploaded, 0);
    }
    assert.equal(lookups, 2);
    const deletion = new DeleteSolicitudAdjuntoUseCase({
      ...dependencies,
      now: () => new Date(),
    });
    await assert.rejects(
      () =>
        deletion.execute({ ...input, adjuntoId: "adj-1", deletedBy: "user-1" }),
      ForbiddenSolicitudAdjuntoAccessError,
    );
    assert.equal(deleted, 0);
    await deletion.execute({
      ...input,
      adjuntoId: "adj-1",
      deletedBy: "admin",
      currentUser: { ...input.currentUser, isSystemAdmin: true },
    });
    assert.equal(deleted, 1);
  });
}
