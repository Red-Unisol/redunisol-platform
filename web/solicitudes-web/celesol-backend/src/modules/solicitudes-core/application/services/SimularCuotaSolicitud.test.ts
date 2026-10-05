import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SimulacionPrestamo } from "../../../solicitudes/infrastructure/services/PrestamosSimulacionGateway";
import { SimularCuotaSolicitud } from "./SimularCuotaSolicitud";

// Valores reales devueltos por el legado para 6.000.000 en 24 cuotas de la
// linea CAJA PREMIUM +1.
function simulacion(
  overrides: Partial<SimulacionPrestamo> = {},
): SimulacionPrestamo {
  return {
    capital: 7998600,
    capitalPuro: false,
    cuotaResultante: 677916.2,
    cuotas: 24,
    cuotasDetalle: null,
    fechaPrimerVencimiento: "2026-10-31T00:00:00",
    fechaUltimaCuota: "2028-09-30T00:00:00-03:00",
    gastos: 1998600,
    intereses: 8271388.99,
    iva: 0,
    lineaDescripcion: "CAJA PREMIUM +1",
    lineaId: 2673,
    montoAFinanciar: 6000000,
    montoSujetoASellado: 7998600,
    sellado: 0,
    tasa: 0.0668,
    tem: 0.0668,
    total: 16269988.99,
    ...overrides,
  };
}

const INPUT = {
  cuotas: 24,
  fechaPrimerVencimiento: null,
  lineaPrestamoLegacyOid: "2673",
  montoAFinanciar: 6000000,
};

describe("SimularCuotaSolicitud", () => {
  it("formats the cuota with two decimals and trims the date", async () => {
    let capturedInput: unknown;
    const service = new SimularCuotaSolicitud({
      gateway: {
        simular: async (input) => {
          capturedInput = input;
          return simulacion();
        },
      },
    });

    const result = await service.execute(INPUT);

    // Con formatMoneyValue esto daba "$6.779.162": diez veces mas y sin centavos.
    assert.deepEqual(result, {
      cuotaResultante: "677.916,20",
      fechaPrimerVencimiento: "2026-10-31",
    });
    assert.deepEqual(capturedInput, {
      capitalPuro: false,
      cuotas: 24,
      lineaId: 2673,
      montoAFinanciar: 6000000,
    });
  });

  it("forwards the fecha when the solicitud already has one", async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const service = new SimularCuotaSolicitud({
      gateway: {
        simular: async (input) => {
          capturedInput = input as Record<string, unknown>;
          return simulacion({ fechaPrimerVencimiento: "2027-01-31T00:00:00" });
        },
      },
    });

    const result = await service.execute({
      ...INPUT,
      fechaPrimerVencimiento: "2027-01-31",
    });

    assert.equal(capturedInput?.fechaPrimerVencimiento, "2027-01-31");
    assert.equal(result?.fechaPrimerVencimiento, "2027-01-31");
  });

  it("returns null without calling the legacy system when data is missing", async () => {
    let called = false;
    const service = new SimularCuotaSolicitud({
      gateway: {
        simular: async () => {
          called = true;
          return simulacion();
        },
      },
    });

    assert.equal(await service.execute({ ...INPUT, montoAFinanciar: null }), null);
    assert.equal(await service.execute({ ...INPUT, cuotas: null }), null);
    assert.equal(
      await service.execute({ ...INPUT, lineaPrestamoLegacyOid: null }),
      null,
    );
    assert.equal(called, false);
  });

  it("returns null when the legacy system fails, so the solicitud can still be saved", async () => {
    const service = new SimularCuotaSolicitud({
      gateway: {
        simular: async () => {
          throw new Error("legacy down");
        },
      },
    });

    assert.equal(await service.execute(INPUT), null);
  });
});
