import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import {
  EvaluacionStorageUnavailableError,
  SolicitudNotFoundError,
} from "../../domain/riesgo-errors";
import type { EvaluacionRiesgoGuardada } from "../../domain/repositories/EvaluacionRiesgoRepository";
import { GetEvaluacionRiesgoUseCase } from "./GetEvaluacionRiesgo.use-case";

const GUARDADA: EvaluacionRiesgoGuardada = {
  guardadaEn: new Date("2026-10-08T15:00:00.000Z"),
  guardadaPor: { id: "analista-1", nombre: "Ana Riesgo" },
  nivelRiesgo: 4,
  storageBucket: "solicitudes",
  storageKey: "evaluaciones/sol-1.json",
};
const ESTADO = {
  code: "RevisionRiesgo",
  id: "st-1",
  name: "Revision",
  ownerId: "owner-riesgo",
};

function armar(
  overrides: {
    contenido?: string;
    evaluacion?: EvaluacionRiesgoGuardada | null;
    existeSolicitud?: boolean;
    falloAlLeer?: boolean;
  } = {},
) {
  const lecturas: Array<{ bucket: string; key: string }> = [];
  const useCase = new GetEvaluacionRiesgoUseCase({
    objectStorage: {
      getObjectStream: async (input) => {
        lecturas.push(input);
        if (overrides.falloAlLeer) {
          throw new Error("minio caido");
        }
        return Readable.from([
          Buffer.from(
            overrides.contenido ?? JSON.stringify({ sheets: { s1: {} } }),
          ),
        ]);
      },
    },
    repository: {
      findBySolicitudId: async () =>
        overrides.evaluacion === undefined ? GUARDADA : overrides.evaluacion,
      findEstadoActualDeSolicitud: async () =>
        overrides.existeSolicitud === false ? null : ESTADO,
    },
  });

  return { lecturas, useCase };
}

describe("GetEvaluacionRiesgoUseCase", () => {
  it("devuelve la planilla guardada con quien y cuando la guardo", async () => {
    const { lecturas, useCase } = armar();

    const evaluacion = await useCase.execute({ solicitudId: "sol-1" });

    assert.deepEqual(lecturas, [
      { bucket: "solicitudes", key: "evaluaciones/sol-1.json" },
    ]);
    assert.deepEqual(evaluacion, {
      guardadaEn: "2026-10-08T15:00:00.000Z",
      guardadaPor: { id: "analista-1", nombre: "Ana Riesgo" },
      nivelRiesgo: 4,
      snapshot: { sheets: { s1: {} } },
    });
  });

  it("devuelve null si la solicitud todavia no tiene evaluacion", async () => {
    const { lecturas, useCase } = armar({ evaluacion: null });

    assert.equal(await useCase.execute({ solicitudId: "sol-1" }), null);
    assert.equal(lecturas.length, 0);
  });

  it("avisa si no puede leer el almacenamiento", async () => {
    const { useCase } = armar({ falloAlLeer: true });

    await assert.rejects(
      () => useCase.execute({ solicitudId: "sol-1" }),
      EvaluacionStorageUnavailableError,
    );
  });

  it("avisa si el archivo guardado no es JSON valido", async () => {
    const { useCase } = armar({ contenido: "no es json" });

    await assert.rejects(
      () => useCase.execute({ solicitudId: "sol-1" }),
      EvaluacionStorageUnavailableError,
    );
  });

  it("falla si la solicitud no existe", async () => {
    const { useCase } = armar({ existeSolicitud: false });

    await assert.rejects(
      () => useCase.execute({ solicitudId: "sol-404" }),
      SolicitudNotFoundError,
    );
  });
});
