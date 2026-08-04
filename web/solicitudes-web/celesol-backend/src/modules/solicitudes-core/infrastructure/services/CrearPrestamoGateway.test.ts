import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PrestamoLegacyRechazadoError,
  PrestamoLegacyUnavailableError,
} from "../../domain/solicitudes-core-errors";
import { CrearPrestamoGateway } from "./CrearPrestamoGateway";

describe("CrearPrestamoGateway", () => {
  it("sends the expected body and returns the id on success", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    const gateway = new CrearPrestamoGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (input, init) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));

        return {
          json: async () => ({ Error: null, ID: 42, Ok: true }),
          ok: true,
        };
      },
    );

    const result = await gateway.crear({
      cuotas: 6,
      fechaEmision: "2026-07-22",
      integrantes: [{ socio: "143471", tipoRelacion: "Titular" }],
      lineaPrestamo: "2519",
      montoDeseado: "10000",
      vendedor: "347",
    });

    assert.equal(result.id, "42");
    assert.equal(
      capturedUrl,
      "https://legacy.example.com/api/Simulador/CrearPrestamo",
    );
    assert.deepEqual(capturedBody, {
      campos: {
        Cuotas: 6,
        FechaEmision: "2026-07-22",
        Integrantes: [{ Socio: "143471", TipoRelacion: "Titular" }],
        LineaPrestamo: "2519",
        MontoDeseado: "10000",
        Vendedor: "347",
      },
      validar: false,
    });
  });

  it("throws PrestamoLegacyRechazadoError with the legacy message when Ok is false", async () => {
    const gateway = new CrearPrestamoGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({
        json: async () => ({
          Error: "Errores de validacion: Ingrese un Celular Valido",
          ID: null,
          Ok: false,
        }),
        ok: true,
      }),
    );

    await assert.rejects(
      () =>
        gateway.crear({
          cuotas: 6,
          fechaEmision: "2026-07-22",
          integrantes: [{ socio: "143471", tipoRelacion: "Titular" }],
          lineaPrestamo: "2519",
          montoDeseado: "10000",
          vendedor: "347",
        }),
      (error: unknown) => {
        assert.ok(error instanceof PrestamoLegacyRechazadoError);
        assert.equal(
          error.message,
          "Errores de validacion: Ingrese un Celular Valido",
        );
        return true;
      },
    );
  });

  it("throws PrestamoLegacyRechazadoError with a default message when Error is missing", async () => {
    const gateway = new CrearPrestamoGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({
        json: async () => ({ Error: null, ID: null, Ok: false }),
        ok: true,
      }),
    );

    await assert.rejects(
      () =>
        gateway.crear({
          cuotas: 6,
          fechaEmision: "2026-07-22",
          integrantes: [{ socio: "143471", tipoRelacion: "Titular" }],
          lineaPrestamo: "2519",
          montoDeseado: "10000",
          vendedor: "347",
        }),
      (error: unknown) => {
        assert.ok(error instanceof PrestamoLegacyRechazadoError);
        assert.equal(
          error.message,
          "No se pudo dar de alta el préstamo en el legado.",
        );
        return true;
      },
    );
  });

  it("throws PrestamoLegacyUnavailableError when the request fails", async () => {
    const gateway = new CrearPrestamoGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => {
        throw new Error("network down");
      },
    );

    await assert.rejects(
      () =>
        gateway.crear({
          cuotas: 6,
          fechaEmision: "2026-07-22",
          integrantes: [{ socio: "143471", tipoRelacion: "Titular" }],
          lineaPrestamo: "2519",
          montoDeseado: "10000",
          vendedor: "347",
        }),
      PrestamoLegacyUnavailableError,
    );
  });

  it("throws PrestamoLegacyUnavailableError when the response body is not valid JSON", async () => {
    const gateway = new CrearPrestamoGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
        ok: true,
      }),
    );

    await assert.rejects(
      () =>
        gateway.crear({
          cuotas: 6,
          fechaEmision: "2026-07-22",
          integrantes: [{ socio: "143471", tipoRelacion: "Titular" }],
          lineaPrestamo: "2519",
          montoDeseado: "10000",
          vendedor: "347",
        }),
      PrestamoLegacyUnavailableError,
    );
  });
});
