import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EvaluacionStorageUnavailableError,
  ForbiddenGuardarEvaluacionError,
  SolicitudNotFoundError,
} from "../../domain/riesgo-errors";
import type { GuardarEvaluacionRiesgoInput } from "../../domain/repositories/EvaluacionRiesgoRepository";
import { GuardarEvaluacionRiesgoUseCase } from "./GuardarEvaluacionRiesgo.use-case";

const AHORA = new Date("2026-10-08T15:00:00.000Z");
const SNAPSHOT = { id: "wb", sheets: { s1: { name: "Evaluacion" } } };
const EN_RIESGO = {
  code: "RevisionRiesgo",
  id: "st-1",
  name: "Revision",
  ownerId: "owner-riesgo",
};

const analistaRiesgo = {
  id: "analista-1",
  workflowOwnerCode: "RIESGO",
  workflowOwnerId: "owner-riesgo",
};

function armar(
  overrides: {
    estado?: typeof EN_RIESGO | null;
    falloAlSubir?: boolean;
  } = {},
) {
  const subidos: Array<{
    body: string;
    bucket: string;
    contentType: string;
    key: string;
  }> = [];
  const guardados: Array<{
    input: GuardarEvaluacionRiesgoInput;
    solicitudId: string;
  }> = [];
  const useCase = new GuardarEvaluacionRiesgoUseCase({
    now: () => AHORA,
    objectStorage: {
      uploadObject: async (input) => {
        if (overrides.falloAlSubir) {
          throw new Error("minio caido");
        }
        subidos.push({ ...input, body: input.body.toString("utf-8") });
      },
    },
    repository: {
      findBySolicitudId: async () => ({
        guardadaEn: AHORA,
        guardadaPor: { id: "analista-1", nombre: "Ana Riesgo" },
        nivelRiesgo: 3,
        storageBucket: "solicitudes",
        storageKey: "evaluaciones/sol-1.json",
      }),
      findEstadoActualDeSolicitud: async () =>
        overrides.estado === undefined ? EN_RIESGO : overrides.estado,
      guardar: async (solicitudId, input) => {
        guardados.push({ input, solicitudId });
      },
    },
    storageBucket: "solicitudes",
  });

  return { guardados, subidos, useCase };
}

describe("GuardarEvaluacionRiesgoUseCase", () => {
  it("guarda la planilla en el almacenamiento y la referencia con el nivel de riesgo", async () => {
    const { guardados, subidos, useCase } = armar();

    const resultado = await useCase.execute({
      currentUser: analistaRiesgo,
      nivelRiesgo: 3,
      snapshot: SNAPSHOT,
      solicitudId: "sol-1",
    });

    assert.deepEqual(subidos, [
      {
        body: JSON.stringify(SNAPSHOT),
        bucket: "solicitudes",
        contentType: "application/json",
        key: "evaluaciones/sol-1.json",
      },
    ]);
    assert.deepEqual(guardados, [
      {
        input: {
          guardadaEn: AHORA,
          guardadaPorId: "analista-1",
          nivelRiesgo: 3,
          storageBucket: "solicitudes",
          storageKey: "evaluaciones/sol-1.json",
        },
        solicitudId: "sol-1",
      },
    ]);
    assert.deepEqual(resultado, {
      guardadaEn: AHORA.toISOString(),
      guardadaPor: { id: "analista-1", nombre: "Ana Riesgo" },
      nivelRiesgo: 3,
    });
  });

  it("deja guardar a un admin aunque la solicitud no este a su cargo", async () => {
    const { guardados, useCase } = armar();

    await useCase.execute({
      currentUser: { id: "admin-1", isSystemAdmin: true, workflowOwnerId: null },
      nivelRiesgo: null,
      snapshot: SNAPSHOT,
      solicitudId: "sol-1",
    });

    assert.equal(guardados.length, 1);
  });

  it("no deja guardar a Riesgo si la solicitud esta a cargo de otra area", async () => {
    const { subidos, useCase } = armar({
      estado: { ...EN_RIESGO, code: "Transferir", ownerId: "owner-tesoreria" },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: analistaRiesgo,
          nivelRiesgo: 2,
          snapshot: SNAPSHOT,
          solicitudId: "sol-1",
        }),
      ForbiddenGuardarEvaluacionError,
    );
    assert.equal(subidos.length, 0);
  });

  it("no deja guardar a otra area aunque tenga la solicitud a cargo", async () => {
    const { useCase } = armar({
      estado: { ...EN_RIESGO, code: "CargaVendedor", ownerId: "owner-vendedores" },
    });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: {
            id: "vendedor-1",
            workflowOwnerCode: "VENDEDORES",
            workflowOwnerId: "owner-vendedores",
          },
          nivelRiesgo: 2,
          snapshot: SNAPSHOT,
          solicitudId: "sol-1",
        }),
      ForbiddenGuardarEvaluacionError,
    );
  });

  it("no registra nada si falla el almacenamiento", async () => {
    const { guardados, useCase } = armar({ falloAlSubir: true });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: analistaRiesgo,
          nivelRiesgo: 2,
          snapshot: SNAPSHOT,
          solicitudId: "sol-1",
        }),
      EvaluacionStorageUnavailableError,
    );
    assert.equal(guardados.length, 0);
  });

  it("falla si la solicitud no existe", async () => {
    const { useCase } = armar({ estado: null });

    await assert.rejects(
      () =>
        useCase.execute({
          currentUser: analistaRiesgo,
          nivelRiesgo: 2,
          snapshot: SNAPSHOT,
          solicitudId: "sol-404",
        }),
      SolicitudNotFoundError,
    );
  });
});
