import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SocioMutualLegacyUnavailableError } from "../../domain/socios-errors";
import { EvaluateListSociosMutualGateway } from "./EvaluateListSociosMutualGateway";

describe("EvaluateListSociosMutualGateway", () => {
  it("requests EvaluateList with the expected cmd/tipo/campos/max and maps positional rows", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    const gateway = new EvaluateListSociosMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (input, init) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));

        return {
          json: async () => [
            [
              220844,
              "20409126",
              "20409126419",
              "Juan",
              "Perez",
              "Perez Juan",
              "1985-03-10",
              "1",
              "DNI",
              "3411234567",
              "juan@example.com",
            ],
          ],
          ok: true,
        };
      },
    );

    const rows = await gateway.fetchPage(0, 500);

    assert.equal(
      capturedUrl,
      "https://legacy.example.com/api/Empresa/EvaluateList",
    );
    assert.deepEqual(capturedBody, {
      cmd: "[ID] > 0",
      tipo: "F.Module.SocioMutual",
      campos:
        "ID;NroDoc;CUIT;Nombre;Apellido;NombreCompleto;FechaDeNacimiento;Sexo;TipoDoc.Descripcion;Celular;Email",
      max: 500,
    });
    assert.deepEqual(rows, [
      {
        id: 220844,
        nroDoc: "20409126",
        cuit: "20409126419",
        nombre: "Juan",
        apellido: "Perez",
        nombreCompleto: "Perez Juan",
        fechaDeNacimiento: "1985-03-10",
        sexo: "1",
        tipoDocDescripcion: "DNI",
        celular: "3411234567",
        email: "juan@example.com",
      },
    ]);
  });

  it("uses the given cursor id in the cmd", async () => {
    let capturedBody: { cmd?: string } | undefined;
    const gateway = new EvaluateListSociosMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return { json: async () => [], ok: true };
      },
    );

    await gateway.fetchPage(220844, 500);

    assert.equal(capturedBody?.cmd, "[ID] > 220844");
  });

  it("returns an empty array when the legacy response has no more rows", async () => {
    const gateway = new EvaluateListSociosMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({ json: async () => [], ok: true }),
    );

    const rows = await gateway.fetchPage(999999, 500);

    assert.deepEqual(rows, []);
  });

  it("throws SocioMutualLegacyUnavailableError when the response is not ok", async () => {
    const gateway = new EvaluateListSociosMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({ json: async () => ({}), ok: false }),
    );

    await assert.rejects(
      () => gateway.fetchPage(0, 500),
      SocioMutualLegacyUnavailableError,
    );
  });

  it("throws SocioMutualLegacyUnavailableError when the fetch itself fails", async () => {
    const gateway = new EvaluateListSociosMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => {
        throw new Error("network down");
      },
    );

    await assert.rejects(
      () => gateway.fetchPage(0, 500),
      SocioMutualLegacyUnavailableError,
    );
  });

  it("throws SocioMutualLegacyUnavailableError when the response body is not an array", async () => {
    const gateway = new EvaluateListSociosMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({ json: async () => ({ Ok: false }), ok: true }),
    );

    await assert.rejects(
      () => gateway.fetchPage(0, 500),
      SocioMutualLegacyUnavailableError,
    );
  });
});
