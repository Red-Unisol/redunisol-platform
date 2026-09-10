import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GetCredixsaSolicitudUseCase } from "./GetCredixsaSolicitud.use-case";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";

const INFORME = {
  cachedAt: "2026-09-10T18:00:00",
  cacheHit: true,
  cuit: "20359661305",
  error: "",
  informe: { persona: { nombre_completo: "SALLITTO NICOLAS" } },
  nombre: "SALLITTO NICOLAS",
  ok: true,
  status: "single",
};

describe("GetCredixsaSolicitudUseCase", () => {
  it("consulta con el CUIL del titular y devuelve el informe", async () => {
    let recibido: unknown;
    const useCase = build({
      obtenerInforme: async (input: unknown) => {
        recibido = input;

        return INFORME;
      },
    });

    const informe = await useCase.execute({ solicitudId: "sol-1" });

    assert.deepEqual(recibido, {
      cuit: "20359661305",
      nombre: "SALLITTO NICOLAS",
      solicitudId: "sol-1",
    });
    assert.equal(informe?.ok, true);
    assert.equal(informe?.cacheHit, true);
  });

  it("usa el mismo timeout configurado", async () => {
    let timeout: number | undefined;
    const useCase = build({
      obtenerInforme: async (_i: unknown, t: number) => {
        timeout = t;

        return INFORME;
      },
    });

    await useCase.execute({ solicitudId: "sol-1" });

    assert.equal(timeout, 90000);
  });

  it("throws cuando la solicitud no existe", async () => {
    const useCase = build({ obtenerInforme: async () => INFORME }, null);

    await assert.rejects(
      () => useCase.execute({ solicitudId: "sol-1" }),
      SolicitudCoreNotFoundError,
    );
  });

  it("devuelve null cuando no se pudo consultar", async () => {
    // Para la pestaña "no se pudo" es un estado valido, no un error 500.
    const useCase = build({ obtenerInforme: async () => null });

    assert.equal(await useCase.execute({ solicitudId: "sol-1" }), null);
  });
});

function build(gateway: unknown, solicitud: unknown = solicitudPorDefecto()) {
  return new GetCredixsaSolicitudUseCase({
    gateway: gateway as never,
    repository: { findById: async () => solicitud } as never,
    timeoutMs: 90000,
  });
}

function solicitudPorDefecto() {
  return {
    id: "sol-1",
    titular: {
      apellidoDenominacion: "SALLITTO",
      cuit: "20-35966130-5",
      nombre: "NICOLAS",
      nroDocumento: "35966130",
    },
  };
}
