import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GenerarComprobanteRefinanciacionUseCase,
  NUMERO_PENDIENTE_DE_COBRO,
} from "./GenerarComprobanteRefinanciacion.use-case";
import { ArchivarComprobanteRefinanciacion } from "../services/ArchivarComprobanteRefinanciacion";
import type { SolicitudAdjunto } from "../../adjuntos/domain/entities/SolicitudAdjunto.entity";

const USUARIO = {
  id: "user-1",
  workflowOwnerCode: "RIESGO",
  workflowOwnerId: "owner-1",
};

describe("GenerarComprobanteRefinanciacionUseCase", () => {
  it("saves the cuotas and stores the comprobante, pending of cobro", async () => {
    const armados: unknown[] = [];
    const guardados: { nombre: string; solicitudId: string }[] = [];
    const useCase = new GenerarComprobanteRefinanciacionUseCase({
      archivar: {
        guardar: async (input) => {
          guardados.push(input);
          return { adjuntoId: "adj-1" };
        },
        quitar: async () => {
          throw new Error("no deberia quitar");
        },
      },
      comprobante: {
        armar: async (input) => {
          armados.push(input);
          return Buffer.from("pdf");
        },
      },
      guardar: {
        execute: async () => ({
          prestamos: [{ cobros: [], nrosCuota: [22, 23], prestamoId: "416700" }],
          simulacion: {
            prestamos: [
              { cuotas: [], ok: true, otros: 0, prestamoId: "416700", punitorios: 11105.88, totalPago: 625851.9 },
            ],
            total: 625851.9,
          },
          updatedAt: new Date(0),
        }),
      },
      hoy: () => "2026-10-28",
    });

    const result = await useCase.execute({
      currentUser: USUARIO,
      prestamos: [{ nrosCuota: [22, 23], prestamoId: "416700" }],
      solicitudId: "sol-1",
    });

    assert.equal(result.adjuntoId, "adj-1");
    assert.deepEqual(armados, [
      {
        prestamos: [{ cuotas: [], numero: NUMERO_PENDIENTE_DE_COBRO, prestamoId: "416700" }],
        // Es el comprobante del legajo, no la simulacion para el socio.
        simulacion: false,
        solicitudId: "sol-1",
      },
    ]);
    assert.equal(guardados[0]?.nombre, "Prestamos Pagos - Refinanciacion 28-10-2026.pdf");
  });

  it("removes the comprobante when the refinanciacion is cleared", async () => {
    const quitados: unknown[] = [];
    const useCase = new GenerarComprobanteRefinanciacionUseCase({
      archivar: {
        guardar: async () => {
          throw new Error("no deberia guardar");
        },
        quitar: async (input) => {
          quitados.push(input);
        },
      },
      comprobante: {
        armar: async () => {
          throw new Error("no deberia armar");
        },
      },
      guardar: {
        execute: async () => ({ prestamos: [], simulacion: null, updatedAt: null }),
      },
    });

    const result = await useCase.execute({
      currentUser: USUARIO,
      prestamos: [],
      solicitudId: "sol-1",
    });

    assert.equal(result.adjuntoId, null);
    assert.deepEqual(quitados, [
      { actorId: "user-1", motivo: "Se quitó la refinanciación.", solicitudId: "sol-1" },
    ]);
  });
});

describe("ArchivarComprobanteRefinanciacion", () => {
  it("stores the new comprobante and then retires the previous ones", async () => {
    const eventos: string[] = [];
    const archivar = new ArchivarComprobanteRefinanciacion({
      adjuntos: {
        create: async (input) => {
          eventos.push(`crear ${input.archivoNombre} ${input.archivoPath?.includes("/adjuntos/refinanciacion-")}`);
          return {} as never;
        },
        listBySolicitudId: async () => [
          adjunto("viejo", "solicitudes/sol-1/adjuntos/refinanciacion-aaa.pdf", null),
          // El del #605: un PDF por cobro, con el mismo prefijo.
          adjunto("viejo-cobro", "solicitudes/sol-1/adjuntos/refinanciacion-18868327-bbb.pdf", null),
          adjunto("borrado", "solicitudes/sol-1/adjuntos/refinanciacion-ccc.pdf", new Date(0)),
          adjunto("recibo", "solicitudes/sol-1/adjuntos/recibo.pdf", null),
        ],
        softDelete: async (input) => {
          eventos.push(`baja ${input.adjuntoId}`);
          return {} as never;
        },
      },
      bucket: "bucket",
      now: () => new Date(0),
      storage: {
        uploadObject: async () => {
          eventos.push("subir");
        },
      },
    });

    await archivar.guardar({
      actorId: "user-1",
      descripcion: "Comprobante",
      nombre: "Prestamos Pagos - Refinanciacion 28-10-2026.pdf",
      pdf: Buffer.from("pdf"),
      solicitudId: "sol-1",
    });

    assert.deepEqual(eventos, [
      "subir",
      "crear Prestamos Pagos - Refinanciacion 28-10-2026.pdf true",
      "baja viejo",
      "baja viejo-cobro",
    ]);
  });
});

function adjunto(
  id: string,
  archivoPath: string,
  deletedAt: Date | null,
): SolicitudAdjunto {
  return { archivoPath, deletedAt, id } as SolicitudAdjunto;
}
