import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GetVendedorDashboardStatsUseCase } from "./GetVendedorDashboardStats.use-case";
import type { VendedorDashboardStatsResult } from "../../domain/repositories/SolicitudesCoreRepository";

describe("GetVendedorDashboardStatsUseCase", () => {
  it("delegates to the repository with the given input", async () => {
    let receivedInput: unknown;
    const result: VendedorDashboardStatsResult = {
      kpis: {
        montoLiquidado: 0,
        aprobadoSinLiquidar: 0,
        solicitudesIniciadas: 0,
        tiempoPromedioDiasLiquidacion: null,
      },
      evolucionMensual: [],
      solicitudesPorEstado: [],
      funnel: [],
      montosPorLinea: [],
      pendientes: [],
      filterOptions: { lineas: [] },
    };
    const useCase = new GetVendedorDashboardStatsUseCase({
      repository: {
        getVendedorStats: async (input: unknown) => {
          receivedInput = input;
          return result;
        },
      } as never,
    });

    const stats = await useCase.execute({
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      vendedorId: "vendedor-1",
    });

    assert.deepEqual(stats, result);
    assert.deepEqual(receivedInput, {
      fechaDesde: "2026-07-01",
      fechaHasta: "2026-07-31",
      vendedorId: "vendedor-1",
    });
  });
});
