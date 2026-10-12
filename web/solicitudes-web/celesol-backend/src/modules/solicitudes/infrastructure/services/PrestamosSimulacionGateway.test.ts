import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LegacySolicitudesUnavailableError,
  PrestamoSimulacionRechazadaError,
} from "../../domain/solicitudes-errors";
import { PrestamosSimulacionGateway } from "./PrestamosSimulacionGateway";

describe("PrestamosSimulacionGateway", () => {
  it("maps a successful PascalCase response with cuotas detalle to camelCase", async () => {
    const gateway = new PrestamosSimulacionGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({
        json: async () => ({
          Capital: 100000,
          CapitalPuro: false,
          Cuotas: 6,
          CuotaResultante: 18500.5,
          CuotasDetalle: [
            {
              Capital: 16000,
              FechaVencimiento: "2026-08-04T00:00:00Z",
              Gastos: 500,
              Interes: 2000,
              NumeroCuota: 1,
              Total: 18500,
            },
          ],
          FechaPrimerVencimiento: "2026-08-04T00:00:00Z",
          FechaUltimaCuota: "2027-01-04T00:00:00Z",
          Gastos: 3000,
          Intereses: 12000,
          IVA: 630,
          LineaDescripcion: "AMEJUCA ESPECIAL",
          LineaId: 2519,
          MontoAFinanciar: 100000,
          MontoSujetoASellado: 100000,
          Sellado: 1000,
          Tasa: 0.165,
          TEM: 0.01375,
          Total: 111000,
        }),
        ok: true,
        status: 200,
      }),
    );

    const result = await gateway.simular({
      capitalPuro: false,
      cuotas: 6,
      lineaId: 2519,
      montoAFinanciar: 100000,
      tasa: 0.165,
    });

    assert.equal(result.lineaId, 2519);
    assert.equal(result.lineaDescripcion, "AMEJUCA ESPECIAL");
    assert.equal(result.cuotaResultante, 18500.5);
    assert.equal(result.tasa, 0.165);
    assert.equal(result.tem, 0.01375);
    assert.equal(result.iva, 630);
    assert.equal(result.cuotasDetalle?.length, 1);
    assert.deepEqual(result.cuotasDetalle?.[0], {
      capital: 16000,
      fechaVencimiento: "2026-08-04T00:00:00Z",
      gastos: 500,
      interes: 2000,
      numeroCuota: 1,
      total: 18500,
    });
  });

  it("maps a successful response with CuotasDetalle null", async () => {
    const gateway = new PrestamosSimulacionGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({
        json: async () => ({
          Capital: 100000,
          CapitalPuro: false,
          Cuotas: 6,
          CuotaResultante: 18500.5,
          CuotasDetalle: null,
          FechaPrimerVencimiento: null,
          FechaUltimaCuota: "2027-01-04T00:00:00Z",
          Gastos: 3000,
          Intereses: 12000,
          IVA: 630,
          LineaDescripcion: "AMEJUCA ESPECIAL",
          LineaId: 2519,
          MontoAFinanciar: 100000,
          MontoSujetoASellado: 100000,
          Sellado: 1000,
          Tasa: 0.165,
          TEM: 0.01375,
          Total: 111000,
        }),
        ok: true,
        status: 200,
      }),
    );

    const result = await gateway.simular({
      capitalPuro: false,
      cuotas: 6,
      lineaId: 2519,
      montoAFinanciar: 100000,
    });

    assert.equal(result.cuotasDetalle, null);
    assert.equal(result.fechaPrimerVencimiento, null);
  });

  it("throws PrestamoSimulacionRechazadaError with the legacy message on 404", async () => {
    const gateway = new PrestamosSimulacionGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({
        json: async () => ({
          error: { code: "404", message: "Línea de préstamo 1 no encontrada" },
        }),
        ok: false,
        status: 404,
      }),
    );

    await assert.rejects(
      () =>
        gateway.simular({
          capitalPuro: false,
          cuotas: 6,
          lineaId: 1,
          montoAFinanciar: 100000,
        }),
      (error) => {
        assert.ok(error instanceof PrestamoSimulacionRechazadaError);
        assert.equal(error.message, "Línea de préstamo 1 no encontrada");
        return true;
      },
    );
  });

  it("throws LegacySolicitudesUnavailableError when the request fails", async () => {
    const gateway = new PrestamosSimulacionGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => {
        throw new Error("network down");
      },
    );

    await assert.rejects(
      () =>
        gateway.simular({
          capitalPuro: false,
          cuotas: 6,
          lineaId: 2519,
          montoAFinanciar: 100000,
        }),
      LegacySolicitudesUnavailableError,
    );
  });

  it("throws LegacySolicitudesUnavailableError on a 500 response instead of a business rejection", async () => {
    const gateway = new PrestamosSimulacionGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({
        json: async () => ({}),
        ok: false,
        status: 500,
      }),
    );

    await assert.rejects(
      () =>
        gateway.simular({
          capitalPuro: false,
          cuotas: 6,
          lineaId: 2519,
          montoAFinanciar: 100000,
        }),
      LegacySolicitudesUnavailableError,
    );
  });

  it("sends a POST with no Authorization header and the expected JSON body", async () => {
    let capturedUrl: string | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const gateway = new PrestamosSimulacionGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (url, init) => {
        capturedUrl = url;
        capturedInit = init;

        return {
          json: async () => ({
            Capital: 100000,
            CapitalPuro: false,
            Cuotas: 6,
            CuotaResultante: 18500.5,
            CuotasDetalle: null,
            FechaPrimerVencimiento: null,
            FechaUltimaCuota: "2027-01-04T00:00:00Z",
            Gastos: 3000,
            Intereses: 12000,
            IVA: 630,
            LineaDescripcion: "AMEJUCA ESPECIAL",
            LineaId: 2519,
            MontoAFinanciar: 100000,
            MontoSujetoASellado: 100000,
            Sellado: 1000,
            Tasa: 0.165,
            TEM: 0.01375,
            Total: 111000,
          }),
          ok: true,
          status: 200,
        };
      },
    );

    await gateway.simular({
      capitalPuro: true,
      cuotas: 6,
      lineaId: 2519,
      montoAFinanciar: 100000,
      tasa: 0.165,
    });

    assert.equal(
      String(capturedUrl),
      "https://legacy.example.com/api/prestamos/simulacion",
    );
    assert.equal(capturedInit?.method, "POST");
    assert.deepEqual(capturedInit?.headers, {
      "Content-Type": "application/json",
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        capturedInit?.headers ?? {},
        "Authorization",
      ),
      false,
    );
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      capitalPuro: true,
      cuotas: 6,
      lineaId: 2519,
      montoAFinanciar: 100000,
      tasa: 0.165,
    });
  });
});

it("preview keeps absent values null and only sends the system calculation inputs", async () => {
  let sent: unknown;
  const gateway = new PrestamosSimulacionGateway(
    { baseUrl: "https://legacy.example.com", timeoutMs: 1000 },
    async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          Capital: null,
          Tasa: 0.165,
          Gastos: 0,
          FechaPrimerVencimiento: "2026-11-30T00:00:00",
          FechaUltimaCuota: null,
          CuotasDetalle: [
            {
              NumeroCuota: 1,
              Capital: null,
              Interes: "",
              Gastos: 0,
              Total: 1500,
              FechaVencimiento: "2026-11-30",
            },
          ],
        }),
      };
    },
  );
  const result = await gateway.simularRevision({
    capitalPuro: false,
    cuotas: 1,
    lineaId: 2519,
    montoAFinanciar: 1500,
  });
  assert.deepEqual(sent, {
    capitalPuro: false,
    cuotas: 1,
    lineaId: 2519,
    montoAFinanciar: 1500,
  });
  assert.equal(result.capital, null);
  assert.equal(result.cuotaResultante, null);
  assert.equal(result.fechaUltimaCuota, null);
  assert.equal(result.tasa, 0.165);
  assert.deepEqual(result.cuotasDetalle?.[0], {
    numeroCuota: 1,
    capital: null,
    interes: null,
    gastos: 0,
    total: 1500,
    fechaVencimiento: "2026-11-30",
  });
});

it("preview rejects a calculation for different conditions without creating a loan", async () => {
  const gateway = new PrestamosSimulacionGateway(
    { baseUrl: "https://legacy.example.com", timeoutMs: 1000 },
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({ LineaId: 2552, Cuotas: 6, MontoAFinanciar: 10000 }),
    }),
  );
  await assert.rejects(
    gateway.simularRevision({
      capitalPuro: false,
      cuotas: 6,
      lineaId: 2519,
      montoAFinanciar: 10000,
    }),
    PrestamoSimulacionRechazadaError,
  );
});
