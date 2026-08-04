import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SolicitudAdjunto } from "../../adjuntos/domain/entities/SolicitudAdjunto.entity";
import type { SolicitudAdjuntoRepository } from "../../adjuntos/domain/repositories/SolicitudAdjuntoRepository";
import { SolicitudReciboSueldoAdjuntoRequiredForWorkflowError } from "../../domain/solicitudes-core-errors";
import { EnsureSolicitudHasReciboSueldoAdjunto } from "./EnsureSolicitudHasReciboSueldoAdjunto";

describe("EnsureSolicitudHasReciboSueldoAdjunto", () => {
  describe("check", () => {
    it("returns true when a non-deleted Recibo de Sueldo adjunto exists", async () => {
      const service = new EnsureSolicitudHasReciboSueldoAdjunto({
        adjuntoRepository: adjuntoRepository({
          listBySolicitudId: async () => [reciboSueldoAdjunto()],
        }),
      });

      const result = await service.check("sol-1");

      assert.equal(result, true);
    });

    it("returns false when there are no adjuntos", async () => {
      const service = new EnsureSolicitudHasReciboSueldoAdjunto({
        adjuntoRepository: adjuntoRepository({
          listBySolicitudId: async () => [],
        }),
      });

      const result = await service.check("sol-1");

      assert.equal(result, false);
    });

    it("returns false when the only Recibo de Sueldo adjunto is soft-deleted", async () => {
      const service = new EnsureSolicitudHasReciboSueldoAdjunto({
        adjuntoRepository: adjuntoRepository({
          listBySolicitudId: async () => [
            reciboSueldoAdjunto({
              deletedAt: new Date("2026-06-01T00:00:00.000Z"),
              deletedBy: "user-2",
              deleteReason: "Duplicado",
            }),
          ],
        }),
      });

      const result = await service.check("sol-1");

      assert.equal(result, false);
    });

    it("returns false when adjuntos exist but none is tipo Recibo de Sueldo", async () => {
      const service = new EnsureSolicitudHasReciboSueldoAdjunto({
        adjuntoRepository: adjuntoRepository({
          listBySolicitudId: async () => [
            reciboSueldoAdjunto({ tipoAdjunto: "DNI" }),
          ],
        }),
      });

      const result = await service.check("sol-1");

      assert.equal(result, false);
    });
  });

  describe("execute", () => {
    it("resolves when a Recibo de Sueldo adjunto exists", async () => {
      const service = new EnsureSolicitudHasReciboSueldoAdjunto({
        adjuntoRepository: adjuntoRepository({
          listBySolicitudId: async () => [reciboSueldoAdjunto()],
        }),
      });

      await assert.doesNotReject(() => service.execute("sol-1"));
    });

    it("throws SolicitudReciboSueldoAdjuntoRequiredForWorkflowError when none exists", async () => {
      const service = new EnsureSolicitudHasReciboSueldoAdjunto({
        adjuntoRepository: adjuntoRepository({
          listBySolicitudId: async () => [],
        }),
      });

      await assert.rejects(
        () => service.execute("sol-1"),
        SolicitudReciboSueldoAdjuntoRequiredForWorkflowError,
      );
    });
  });
});

function reciboSueldoAdjunto(
  overrides: Partial<SolicitudAdjunto> = {},
): SolicitudAdjunto {
  return {
    id: "adjunto-1",
    solicitudId: "sol-1",
    archivoNombre: "recibo.pdf",
    archivoPath: "solicitudes/sol-1/recibo.pdf",
    archivoMimeType: "application/pdf",
    archivoSizeBytes: 1024,
    storageBucket: "celesol-adjuntos",
    tipoAdjunto: "Recibo de Sueldo",
    estadoAdjunto: null,
    descripcion: null,
    adicional: null,
    comentario: null,
    nroDocumento: null,
    restringido: false,
    uploadedBy: "user-1",
    uploadedByName: "Vendedor Uno",
    uploadedAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    ...overrides,
  };
}

function adjuntoRepository(
  overrides: Partial<SolicitudAdjuntoRepository> = {},
): SolicitudAdjuntoRepository {
  return {
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
    ...overrides,
  };
}
