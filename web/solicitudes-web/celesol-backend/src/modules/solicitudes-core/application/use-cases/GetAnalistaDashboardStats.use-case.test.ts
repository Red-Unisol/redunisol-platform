import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GetAnalistaDashboardStatsUseCase } from "./GetAnalistaDashboardStats.use-case";
import type { AnalistaDashboardStatsResult } from "../../domain/repositories/SolicitudesCoreRepository";

const emptyResult: AnalistaDashboardStatsResult = {
  backlogPorEstado: [],
  casosConMultiplesRevisiones: [],
  casosParaTomar: [],
  filterOptions: { estados: [], lineas: [], vendedores: [] },
  kpis: {
    asignadosAMi: 0,
    casosConRevision: 0,
    detenidosMasDeNDias: 0,
    sinAsignarEnMiArea: 0,
    tasaDeRechazoPeriodo: null,
  },
  retrabajoYRevisiones: {
    conRetrabajo: 0,
    promedioRevisionesPorCaso: 0,
    tresOMasRevisiones: 0,
  },
  transicionesLentas: [],
};

describe("GetAnalistaDashboardStatsUseCase", () => {
  it("resolves the area owner code and delegates to the repository", async () => {
    let receivedInput: unknown;
    let receivedOwnerId: unknown;
    const useCase = new GetAnalistaDashboardStatsUseCase({
      repository: {
        findWorkflowOwnerCodeById: async (id: string) => {
          receivedOwnerId = id;
          return "RIESGO";
        },
        getAnalistaStats: async (input: unknown) => {
          receivedInput = input;
          return emptyResult;
        },
      } as never,
    });

    const stats = await useCase.execute({
      analistaId: "analista-1",
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      umbralDias: 7,
      vista: "mis_casos",
      workflowOwnerId: "owner-riesgo-uuid",
    });

    assert.deepEqual(stats, emptyResult);
    assert.equal(receivedOwnerId, "owner-riesgo-uuid");
    assert.deepEqual(receivedInput, {
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      umbralDias: 7,
      vista: "mis_casos",
    });
  });

  it("falls back to an empty area owner code when the user has no workflowOwnerId", async () => {
    let receivedInput: unknown;
    const useCase = new GetAnalistaDashboardStatsUseCase({
      repository: {
        findWorkflowOwnerCodeById: async () => {
          throw new Error("should not be called");
        },
        getAnalistaStats: async (input: unknown) => {
          receivedInput = input;
          return emptyResult;
        },
      } as never,
    });

    await useCase.execute({
      analistaId: "analista-1",
      umbralDias: 7,
      vista: "mis_casos",
      workflowOwnerId: null,
    });

    assert.equal((receivedInput as { areaOwnerCode: string }).areaOwnerCode, "");
  });
});
