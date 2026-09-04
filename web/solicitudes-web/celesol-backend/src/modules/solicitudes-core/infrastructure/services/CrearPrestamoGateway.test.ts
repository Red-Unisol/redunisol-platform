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
    let capturedRawBody: string | undefined;
    let capturedBody: unknown;
    const gateway = new CrearPrestamoGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (input, init) => {
        capturedUrl = String(input);
        capturedRawBody = String(init?.body);
        capturedBody = JSON.parse(capturedRawBody);

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
      montoDeseado: 10000,
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
        // Numero, no string: como texto el legado lo descarta y deja 0,00.
        MontoDeseado: 10000,
        Vendedor: "347",
      },
      validar: false,
    });
  });

  // El legado aplica `campos` en el orden en que llega, y asignar LineaPrestamo
  // resetea Cuotas al minimo de la linea. deepEqual sobre el body parseado NO
  // detecta un reordenamiento (JSON.parse pierde el orden), asi que esto se
  // verifica sobre el JSON crudo. Si alguien reordena las claves
  // alfabeticamente, este test falla.
  it("serializes Cuotas after LineaPrestamo", async () => {
    let capturedRawBody = "";
    const gateway = new CrearPrestamoGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (_input, init) => {
        capturedRawBody = String(init?.body);

        return {
          json: async () => ({ Error: null, ID: 42, Ok: true }),
          ok: true,
        };
      },
    );

    await gateway.crear({
      cuotas: 36,
      fechaEmision: "2026-09-03",
      integrantes: [{ socio: "147393", tipoRelacion: "Titular" }],
      lineaPrestamo: "2674",
      montoDeseado: 6000000,
      vendedor: "351",
    });

    assert.ok(
      capturedRawBody.indexOf('"LineaPrestamo"') <
        capturedRawBody.indexOf('"Cuotas"'),
      "Cuotas tiene que ir despues de LineaPrestamo en el JSON enviado",
    );
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
          montoDeseado: 10000,
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
          montoDeseado: 10000,
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
          montoDeseado: 10000,
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
          montoDeseado: 10000,
          vendedor: "347",
        }),
      PrestamoLegacyUnavailableError,
    );
  });
});
