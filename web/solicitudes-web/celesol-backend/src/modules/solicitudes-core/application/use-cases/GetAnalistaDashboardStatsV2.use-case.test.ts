import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GetAnalistaDashboardStatsV2UseCase } from "./GetAnalistaDashboardStatsV2.use-case";
import type { AnalistaDashboardStatsV2Result } from "../../domain/repositories/SolicitudesCoreRepository";

const emptyResult: AnalistaDashboardStatsV2Result = {
  casosParaTomar: [],
  filterOptions: { estados: [], lineas: [], vendedores: [] },
  historialTrabajo: [],
  kpis: {
    asignadosAMi: 0,
    casosConRevision: 0,
    detenidosMasDeNDias: 0,
    sinAsignarEnMiArea: 0,
  },
  misCasosActivos: [],
};

describe("GetAnalistaDashboardStatsV2UseCase", () => {
  it("resolves the area owner code and delegates to the repository", async () => {
    let receivedInput: unknown;
    let receivedOwnerId: unknown;
    const useCase = new GetAnalistaDashboardStatsV2UseCase({
      repository: {
        findWorkflowOwnerCodeById: async (id: string) => {
          receivedOwnerId = id;
          return "RIESGO";
        },
        getAnalistaStatsV2: async (input: unknown) => {
          receivedInput = input;
          return emptyResult;
        },
      } as never,
    });

    const stats = await useCase.execute({
      analistaId: "analista-1",
      umbralDias: 7,
      vista: "mis_casos",
      workflowOwnerId: "owner-riesgo-uuid",
    });

    assert.deepEqual(stats, emptyResult);
    assert.equal(receivedOwnerId, "owner-riesgo-uuid");
    assert.deepEqual(receivedInput, {
      analistaId: "analista-1",
      areaOwnerCode: "RIESGO",
      umbralDias: 7,
      vista: "mis_casos",
    });
  });
});
