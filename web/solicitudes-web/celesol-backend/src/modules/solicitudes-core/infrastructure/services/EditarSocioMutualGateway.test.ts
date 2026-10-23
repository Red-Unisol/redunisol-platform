import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConvenioSocioLegacyRechazadoError,
  PrestamoLegacyUnavailableError,
} from "../../domain/solicitudes-core-errors";
import { EditarSocioMutualGateway } from "./EditarSocioMutualGateway";

const CONFIG = { baseUrl: "https://legacy.example.com", timeoutMs: 5000 };

describe("EditarSocioMutualGateway", () => {
  it("sends the socio id and the fields to EditarObjeto", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    const gateway = new EditarSocioMutualGateway(CONFIG, async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body));

      return {
        json: async () => ({ Error: null, ID: 141484, Ok: true }),
        ok: true,
      };
    });

    await gateway.editar("141484", {
      "SocAux.Caja40": "50",
      Observaciones: "Depositar en Banco Nación",
    });

    assert.equal(
      capturedUrl,
      "https://legacy.example.com/api/Empresa/EditarObjeto",
    );
    assert.deepEqual(capturedBody, {
      campos: {
        "SocAux.Caja40": "50",
        Observaciones: "Depositar en Banco Nación",
      },
      id: "141484",
      tipo: "SocioMutual",
    });
  });

  it("throws the legacy error when Ok is false", async () => {
    const gateway = new EditarSocioMutualGateway(CONFIG, async () => ({
      json: async () => ({
        Error: "La propiedad 'X' no existe en el tipo 'SocioMutual'.",
        ID: null,
        Ok: false,
      }),
      ok: true,
    }));

    await assert.rejects(
      gateway.editar("141484", { X: "1" }),
      (error: unknown) =>
        error instanceof ConvenioSocioLegacyRechazadoError &&
        error.message.includes("La propiedad 'X' no existe"),
    );
  });

  // Sin el permiso EditarObjetos el legado responde 500 sin cuerpo.
  it("throws unavailable when the response has no JSON body", async () => {
    const gateway = new EditarSocioMutualGateway(CONFIG, async () => ({
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
      ok: false,
    }));

    await assert.rejects(
      gateway.editar("141484", { Email: "a@b.c" }),
      PrestamoLegacyUnavailableError,
    );
  });

  it("throws unavailable when the request fails", async () => {
    const gateway = new EditarSocioMutualGateway(CONFIG, async () => {
      throw new Error("ECONNREFUSED");
    });

    await assert.rejects(
      gateway.editar("141484", { Email: "a@b.c" }),
      PrestamoLegacyUnavailableError,
    );
  });
});
