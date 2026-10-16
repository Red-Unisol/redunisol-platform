import assert from "node:assert/strict";
import { it } from "node:test";
import { AnalizarReciboUseCase } from "./AnalizarRecibo.use-case";
import { MistralReciboGateway } from "../infrastructure/MistralReciboGateway";
import { UploadSolicitudAdjuntosBatchUseCase } from "../../application/use-cases/UploadSolicitudAdjuntosBatch.use-case";
import {
  ownedSolicitud,
  storedAdjunto,
} from "../../application/use-cases/AdjuntosUseCaseTest.fixtures";
import type { CreateSolicitudAdjuntoRecord } from "../../domain/repositories/SolicitudAdjuntoRepository";

for (const failure of [
  "credential",
  "network",
  "quota",
  "unavailable",
  "timeout",
])
  it(`manual upload and persistence still work after OCR ${failure}`, async () => {
    let providerCalls = 0;
    const file = {
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
      fileName: "recibo.png",
      mimeType: "image/png",
      size: 9,
    };
    const gateway = new MistralReciboGateway({
      apiKey: failure === "credential" ? "" : "fixture-key",
      model: "mistral-ocr-latest",
      timeoutMs: 10,
      fetch: (async (url, init) => {
        providerCalls++;
        if (failure === "network") throw new Error("private-network-error");
        if (String(url).endsWith("models"))
          return Response.json({ data: [{ id: "mistral-ocr-latest" }] });
        if (failure === "timeout")
          return new Promise((_resolve, reject) => {
            if (init?.signal?.aborted) reject(new Error("timeout"));
            else
              init?.signal?.addEventListener(
                "abort",
                () => reject(new Error("timeout")),
                { once: true },
              );
          });
        return Response.json(
          { error: "private-provider-error" },
          { status: failure === "quota" ? 429 : 503 },
        );
      }) as typeof fetch,
    });
    const analyze = new AnalizarReciboUseCase({
      gateway,
      configuracion: {
        get: async () => ({ habilitado: true, version: 1 }),
        update: async () => {
          throw new Error("must not change activation");
        },
      },
      allowedExtensions: [".png"],
      allowedMimeTypes: ["image/png"],
      maxFileSizeBytes: 100,
    });
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      const analysis = await analyze.execute(file);
      assert.equal(analysis.resultado, "error");
      const callsBeforeSaving = providerCalls;
      const storedBuffers: Buffer[] = [];
      const records: CreateSolicitudAdjuntoRecord[] = [];
      const save = new UploadSolicitudAdjuntosBatchUseCase({
        allowedExtensions: [".png"],
        allowedMimeTypes: ["image/png"],
        maxFileSizeBytes: 100,
        storageBucket: "fixtures",
        objectStorage: {
          uploadObject: async (input) => {
            storedBuffers.push(input.body);
          },
          deleteObject: async () => {
            throw new Error("unexpected rollback");
          },
          getObjectStream: async () => {
            throw new Error("unexpected read");
          },
        },
        repository: {
          createMany: async (input: CreateSolicitudAdjuntoRecord[]) => {
            records.push(...input);
            return input.map((row) =>
              storedAdjunto({
                id: row.adjuntoId,
                archivoNombre: row.archivoNombre,
                tipoAdjunto: row.tipoAdjunto,
              }),
            );
          },
        } as never,
        solicitudesRepository: {
          findById: async () => ownedSolicitud(),
          findWorkflowOwnerCodeById: async () => "RIESGO",
        } as never,
        fieldAccessRulesRepository: {
          findByWorkflowStateId: async () => null,
        } as never,
      });
      const saved = await save.execute({
        solicitudId: "sol-1",
        createdBy: "user-1",
        workflowOwnerId: "owner-1",
        currentUser: { id: "user-1", workflowOwnerId: "owner-1" },
        files: [{ file, tipoAdjunto: "CUPO" }],
      });
      assert.equal(saved.length, 1);
      assert.equal(saved[0].tipoAdjunto, "CUPO");
      assert.equal(records[0].tipoAdjunto, "CUPO");
      assert.deepEqual(storedBuffers, [file.buffer]);
      assert.equal(providerCalls, callsBeforeSaving);
    } finally {
      clearTimeout(keepAlive);
    }
  });
