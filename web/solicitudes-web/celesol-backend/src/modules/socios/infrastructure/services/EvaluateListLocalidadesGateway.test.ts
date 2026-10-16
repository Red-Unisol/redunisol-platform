import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SocioMutualLegacyUnavailableError } from "../../domain/socios-errors";
import { EvaluateListLocalidadesGateway } from "./EvaluateListLocalidadesGateway";

describe("EvaluateListLocalidadesGateway", () => {
  it("asks EvaluateList for every localidad and maps the positional rows", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    const gateway = new EvaluateListLocalidadesGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (input, init) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));

        return {
          json: async () => [
            [2715, "CORDOBA", "5000", "CORDOBA"],
            [22177, " CHUÑA ", 521801, null],
            [99, "", "1000", "BUENOS AIRES"],
          ],
          ok: true,
        };
      },
    );

    const result = await gateway.fetchAll();

    assert.equal(
      capturedUrl,
      "https://legacy.example.com/api/Empresa/EvaluateList",
    );
    assert.deepEqual(capturedBody, {
      campos: "ID;Nombre;CodigoPostal;Provincia.Nombre",
      cmd: "[ID] > 0",
      max: 50000,
      tipo: "ClasesBase.Localidad",
    });
    assert.deepEqual(result, [
      { codigoPostal: "5000", id: "2715", nombre: "CORDOBA", provincia: "CORDOBA" },
      { codigoPostal: "521801", id: "22177", nombre: "CHUÑA", provincia: null },
    ]);
  });

  it("throws SocioMutualLegacyUnavailableError when Vimarx does not answer", async () => {
    const gateway = new EvaluateListLocalidadesGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => {
        throw new Error("network down");
      },
    );

    await assert.rejects(
      () => gateway.fetchAll(),
      SocioMutualLegacyUnavailableError,
    );
  });

  it("throws SocioMutualLegacyUnavailableError on a non-ok response", async () => {
    const gateway = new EvaluateListLocalidadesGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({ json: async () => ({}), ok: false }),
    );

    await assert.rejects(
      () => gateway.fetchAll(),
      SocioMutualLegacyUnavailableError,
    );
  });
});
