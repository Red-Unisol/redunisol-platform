import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EvaluateListLineaPrestamoLegacyIdResolver } from "./EvaluateListLineaPrestamoLegacyIdResolver";

const CONFIG = { baseUrl: "https://legacy.example.com", timeoutMs: 5000 };

describe("EvaluateListLineaPrestamoLegacyIdResolver", () => {
  it("asks the legacy system for the linea whose LineaSolicitud.Oid matches", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    const resolver = new EvaluateListLineaPrestamoLegacyIdResolver(
      CONFIG,
      async (input, init) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));

        return { json: async () => [[2674, "amejuca"]], ok: true };
      },
    );

    const result = await resolver.resolveByPresolicitudOid("2673");

    assert.deepEqual(result, { codigoMutual: "amejuca", id: "2674" });
    assert.equal(
      capturedUrl,
      "https://legacy.example.com/api/Empresa/EvaluateList",
    );
    assert.deepEqual(capturedBody, {
      campos: "ID;[Terminos y condiciones].Descripcion",
      cmd: "[LineaSolicitud.Oid] = 2673",
      max: 2,
      tipo: "F.Module.Cuentas.Prestamos.LineaPrestamo",
    });
  });

  it("resolves the linea even when it has no codigo de mutual", async () => {
    // Pasa seguido: de las 124 lineas que hoy puede elegir un vendedor, 26 no
    // tienen cargado [Terminos y condiciones]. El prestamo se crea igual.
    const resolver = new EvaluateListLineaPrestamoLegacyIdResolver(
      CONFIG,
      async () => ({ json: async () => [[2674, null]], ok: true }),
    );

    assert.deepEqual(await resolver.resolveByPresolicitudOid("2673"), {
      codigoMutual: null,
      id: "2674",
    });
  });

  it("returns null when no linea points back to that oid", async () => {
    const resolver = new EvaluateListLineaPrestamoLegacyIdResolver(
      CONFIG,
      async () => ({ json: async () => [], ok: true }),
    );

    assert.equal(await resolver.resolveByPresolicitudOid("2638"), null);
  });

  it("returns null when more than one linea points back to that oid", async () => {
    const resolver = new EvaluateListLineaPrestamoLegacyIdResolver(
      CONFIG,
      async () => ({
        json: async () => [
          [2585, "muci"],
          [2608, "caja"],
        ],
        ok: true,
      }),
    );

    assert.equal(await resolver.resolveByPresolicitudOid("2586"), null);
  });

  it("rejects a non numeric oid without calling the legacy system", async () => {
    let called = false;
    const resolver = new EvaluateListLineaPrestamoLegacyIdResolver(
      CONFIG,
      async () => {
        called = true;
        return { json: async () => [[1, "caja"]], ok: true };
      },
    );

    assert.equal(await resolver.resolveByPresolicitudOid("2673 OR 1=1"), null);
    assert.equal(called, false);
  });

  it("returns null when the legacy system fails", async () => {
    const resolver = new EvaluateListLineaPrestamoLegacyIdResolver(
      CONFIG,
      async () => {
        throw new Error("network down");
      },
    );

    assert.equal(await resolver.resolveByPresolicitudOid("2673"), null);
  });
});
