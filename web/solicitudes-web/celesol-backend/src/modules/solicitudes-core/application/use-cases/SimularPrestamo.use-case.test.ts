import { CalculoConValoresEfectivosError } from "../../domain/solicitudes-core-errors";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LegacyLineaPrestamoUnavailableError } from "../../domain/solicitudes-core-errors";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";
import type { PrestamosSimulacionGateway } from "../../../solicitudes/infrastructure/services/PrestamosSimulacionGateway";
import { SimularPrestamoUseCase } from "./SimularPrestamo.use-case";

function catalogWith(
  linea: { descripcion: string; legacyOid: string; vigente: boolean; montoMaximo?: number; cantidadMaximaCuotas?: number } | null,
): LineasPrestamoCatalog {
  return {
    findByLegacyUserAndOid: async () => linea,
  };
}

function fakeGateway(
  result: unknown = {
    capital: 100000,
    capitalPuro: false,
    cuotaResultante: 18500.5,
    cuotas: 6,
    cuotasDetalle: null,
    fechaPrimerVencimiento: null,
    fechaUltimaCuota: "2027-01-04T00:00:00Z",
    gastos: 3000,
    intereses: 12000,
    iva: 630,
    lineaDescripcion: "AMEJUCA ESPECIAL",
    lineaId: 2519,
    montoAFinanciar: 100000,
    montoSujetoASellado: 100000,
    sellado: 1000,
    tasa: 0.165,
    tem: 0.01375,
    total: 111000,
  },
): PrestamosSimulacionGateway {
  return {
    simular: async () => result,
  } as unknown as PrestamosSimulacionGateway;
}

describe("SimularPrestamoUseCase", () => {
  it("calls the gateway when the line belongs to the authenticated agent", async () => {
    let receivedInput: unknown;
    const gateway = {
      simular: async (input: unknown) => {
        receivedInput = input;

        return fakeGateway().simular(input as never);
      },
    } as unknown as PrestamosSimulacionGateway;
    const useCase = new SimularPrestamoUseCase({
      repository: {} as never,
      gateway,
      lineasPrestamoCatalog: catalogWith({
        montoMaximo: 10000000, cantidadMaximaCuotas: 48,
        descripcion: "AMEJUCA ESPECIAL",
        legacyOid: "2519",
        vigente: true,
      }),
    });

    const result = await useCase.execute({
      capitalPuro: false,
      cuotas: 6,
      legacyUser: "EGALLAY",
      lineaId: 2519,
      montoAFinanciar: 100000,
      tasa: 0.165,
    });

    assert.equal(result.lineaId, 2519);
    assert.deepEqual(receivedInput, {
      capitalPuro: false,
      cuotas: 6,
      fechaPrimerVencimiento: undefined,
      lineaId: 2519,
      montoAFinanciar: 100000,
      tasa: 0.165,
    });
  });

  it("rejects when the line does not belong to the authenticated agent", async () => {
    let gatewayCallCount = 0;
    const useCase = new SimularPrestamoUseCase({
      repository: {} as never,
      gateway: {
        simular: async (input: unknown) => {
          gatewayCallCount += 1;

          return fakeGateway().simular(input as never);
        },
      } as unknown as PrestamosSimulacionGateway,
      lineasPrestamoCatalog: catalogWith(null),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          capitalPuro: false,
          cuotas: 6,
          legacyUser: "EGALLAY",
          lineaId: 999999,
          montoAFinanciar: 100000,
        }),
      LegacyLineaPrestamoUnavailableError,
    );
    assert.equal(gatewayCallCount, 0);
  });

  it("rejects when the line is not vigente", async () => {
    let gatewayCallCount = 0;
    const useCase = new SimularPrestamoUseCase({
      repository: {} as never,
      gateway: {
        simular: async (input: unknown) => {
          gatewayCallCount += 1;

          return fakeGateway().simular(input as never);
        },
      } as unknown as PrestamosSimulacionGateway,
      lineasPrestamoCatalog: catalogWith({
        montoMaximo: 10000000, cantidadMaximaCuotas: 48,
        descripcion: "LINEA VIEJA",
        legacyOid: "10",
        vigente: false,
      }),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          capitalPuro: false,
          cuotas: 6,
          legacyUser: "EGALLAY",
          lineaId: 10,
          montoAFinanciar: 100000,
        }),
      LegacyLineaPrestamoUnavailableError,
    );
    assert.equal(gatewayCallCount, 0);
  });
});

it("adjusts before simulation and uses the request seller instead of the authenticated editor", async () => {
  let received: unknown;
  let catalogUser: string | undefined;
  const useCase = new SimularPrestamoUseCase({
    repository: { findById: async () => ({ id: "sol" }) as never, findVendedorLegacyUser: async () => "seller" },
    lineasPrestamoCatalog: { findByLegacyUserAndOid: async (user) => { catalogUser = user; return { descripcion: "L", legacyOid: "2519", vigente: true, montoMaximo: 50000, cantidadMaximaCuotas: 6 }; } },
    gateway: { simular: async (input: unknown) => { received = input; return { lineaId: 2519, montoAFinanciar: 50000, cuotas: 6, cuotaResultante: 9000 }; } } as never,
  });
  const result = await useCase.execute({ solicitudId: "sol", legacyUser: "risk-editor", capitalPuro: false, lineaId: 2519, montoAFinanciar: 1000000, cuotas: 48 });
  assert.equal(catalogUser, "seller");
  assert.equal(result.cuotas, 6);
  assert.deepEqual(received, { capitalPuro: false, lineaId: 2519, montoAFinanciar: 50000, cuotas: 6, fechaPrimerVencimiento: undefined, tasa: undefined });
});
it("does not present a legacy calculation with different installment conditions as current", async () => {
  const useCase = new SimularPrestamoUseCase({ repository: {} as never, lineasPrestamoCatalog: catalogWith({ descripcion: "L", legacyOid: "2519", vigente: true, montoMaximo: 10000000, cantidadMaximaCuotas: 48 }), gateway: fakeGateway() });
  await assert.rejects(useCase.execute({ legacyUser: "seller", capitalPuro: false, lineaId: 2519, montoAFinanciar: 100000, cuotas: 48 }), CalculoConValoresEfectivosError);
});
