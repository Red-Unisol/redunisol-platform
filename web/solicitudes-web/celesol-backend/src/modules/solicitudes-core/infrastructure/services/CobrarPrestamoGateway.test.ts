import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PrestamoLegacyRechazadoError,
  PrestamoLegacyUnavailableError,
} from "../../domain/solicitudes-core-errors";
import { CobrarPrestamoGateway } from "./CobrarPrestamoGateway";

describe("CobrarPrestamoGateway", () => {
  it("sends the cobro with cobradorId and maps the simulated result", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    const gateway = new CobrarPrestamoGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (input, init) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));

        return {
          // Forma real de FapiTest (27/10/2026, prestamo 414805, cuotas 24 y 25).
          json: async () => ({
            Capital: 18886.87,
            CobroId: 0,
            Cuotas: [
              {
                CuotaId: 16868253,
                FechaVto: "2026-09-30T00:00:00",
                InteresPagado: 18668.32,
                NroCuota: 24,
                OtrosPagado: 0,
                PunitoriosPagados: 1122.06,
                TotalPagado: 28827.16,
              },
              {
                CuotaId: 16868254,
                FechaVto: "2026-10-31T00:00:00",
                InteresPagado: 17855.01,
                NroCuota: 25,
                OtrosPagado: 1413.31,
                PunitoriosPagados: 0,
                TotalPagado: 29118.41,
              },
            ],
            Interes: 36523.33,
            Motivo: 1,
            Otros: 1413.31,
            Punitorios: 1122.06,
            Simulado: true,
            Success: true,
            TotalPago: 57945.57,
          }),
          ok: true,
        };
      },
    );

    const result = await gateway.cobrar({
      cobradorId: 65,
      motivo: 1,
      nrosCuota: [24, 25],
      prestamoId: "414805",
      simulacion: true,
    });

    assert.equal(capturedUrl, "https://legacy.example.com/api/Prestamo/cobrar");
    // "cobradorId", no "idCobrador": con el nombre de PagoDeuda el legado lo
    // ignora y cobra con CAJA, y el prestamo nuevo no toma la refinanciacion.
    assert.deepEqual(capturedBody, {
      cobradorId: 65,
      idPrestamo: 414805,
      motivo: 1,
      nrosCuota: [24, 25],
      pagoTotal: true,
      simulacion: true,
    });
    assert.equal(result.totalPago, 57945.57);
    assert.equal(result.punitorios, 1122.06);
    assert.equal(result.cobroId, "0");
    assert.deepEqual(result.cuotas[1], {
      fechaVto: "2026-10-31T00:00:00",
      interesPagado: 17855.01,
      nroCuota: 25,
      otrosPagado: 1413.31,
      punitoriosPagados: 0,
      totalPagado: 29118.41,
    });
  });

  it("throws the legacy message when the cobro is rejected", async () => {
    const gateway = new CobrarPrestamoGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({
        json: async () => ({
          error: {
            code: "COBRO_NO_GENERADO",
            message:
              "No se pudo simular el cobro. Deben Pagarse 1 cuota/s en prt 997107, comenzando por la cuota nro 24, antes de pagar la cuota nro 25 ",
          },
        }),
        ok: false,
      }),
    );

    await assert.rejects(
      () =>
        gateway.cobrar({
          cobradorId: 65,
          motivo: 1,
          nrosCuota: [25],
          prestamoId: "414805",
          simulacion: true,
        }),
      (error: unknown) =>
        error instanceof PrestamoLegacyRechazadoError &&
        error.message.endsWith("antes de pagar la cuota nro 25"),
    );
  });

  it("throws unavailable when the legacy system does not answer", async () => {
    const gateway = new CobrarPrestamoGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => {
        throw new Error("ECONNREFUSED");
      },
    );

    await assert.rejects(
      () =>
        gateway.cobrar({
          cobradorId: 65,
          motivo: 1,
          nrosCuota: [1],
          prestamoId: "1",
          simulacion: true,
        }),
      PrestamoLegacyUnavailableError,
    );
  });
});
