import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CalculadoraMutualLegacyUnavailableError } from "../../domain/riesgo-errors";
import { ScoringpfVimarxGateway } from "./ScoringpfVimarxGateway";

function gatewayQueResponde(respuesta: unknown, ok = true) {
  const pedidos: Array<{ body: unknown; url: string }> = [];
  const gateway = new ScoringpfVimarxGateway(
    { baseUrl: "https://fapi.test", timeoutMs: 1000 },
    async (url, init) => {
      pedidos.push({ body: JSON.parse(String(init?.body)), url: String(url) });
      return { json: async () => respuesta, ok };
    },
  );
  return { gateway, pedidos };
}

describe("ScoringpfVimarxGateway", () => {
  it("pide SCORINGPF por EvaluateList y devuelve el archivo", async () => {
    const archivo = Buffer.from("planilla");
    const { gateway, pedidos } = gatewayQueResponde([
      [4, "SCORINGPF", archivo.toString("base64")],
    ]);

    assert.deepEqual(await gateway.descargar(), archivo);
    assert.deepEqual(pedidos, [
      {
        body: {
          campos: "ID;Nombre;Hoja",
          cmd: "[Nombre] = 'SCORINGPF'",
          max: 2,
          tipo: "HojaCalculo",
        },
        url: "https://fapi.test/api/Empresa/EvaluateList",
      },
    ]);
  });

  it("acepta la respuesta de Fapi como texto JSON", async () => {
    const { gateway } = gatewayQueResponde(
      JSON.stringify([[4, "SCORINGPF", Buffer.from("x").toString("base64")]]),
    );

    assert.deepEqual(await gateway.descargar(), Buffer.from("x"));
  });

  for (const [caso, respuesta, ok] of [
    ["Fapi responde error", [], false],
    ["no hay planilla", [], true],
    ["hay dos planillas", [[1, "SCORINGPF", "eA=="], [2, "SCORINGPF", "eA=="]], true],
    ["la planilla viene vacía", [[4, "SCORINGPF", ""]], true],
  ] as const) {
    it(`falla si ${caso}`, async () => {
      const { gateway } = gatewayQueResponde(respuesta, ok);
      await assert.rejects(
        () => gateway.descargar(),
        CalculadoraMutualLegacyUnavailableError,
      );
    });
  }
});
