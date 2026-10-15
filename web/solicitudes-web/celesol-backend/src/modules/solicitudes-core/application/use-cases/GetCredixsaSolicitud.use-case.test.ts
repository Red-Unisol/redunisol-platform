import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GetCredixsaSolicitudUseCase } from "./GetCredixsaSolicitud.use-case";
import { SolicitudCoreNotFoundError } from "../../domain/solicitudes-core-errors";
import type { InformeCredixsaGuardado } from "../../domain/repositories/SolicitudCredixsaInformeRepository";
import type { InformeCredixsa } from "../../infrastructure/services/ConsultarCredixsaGateway";

const AHORA = new Date("2026-09-11T12:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;

const INFORME: InformeCredixsa = {
  cachedAt: "2026-09-10T18:00:00+00:00",
  cacheHit: true,
  cuit: "20359661305",
  error: "",
  informe: { persona: { nombre_completo: "SALLITTO NICOLAS" } },
  nombre: "SALLITTO NICOLAS",
  ok: true,
  status: "single",
};

function guardadoHace(dias: number): InformeCredixsaGuardado {
  return {
    consultadoEn: new Date(AHORA.getTime() - dias * DIA_MS),
    cuit: "20359661305",
    informe: { persona: { nombre_completo: "GUARDADO" } },
    nombre: "SALLITTO NICOLAS",
    status: "single",
  };
}

describe("GetCredixsaSolicitudUseCase", () => {
  it("consulta con el CUIL del titular y devuelve el informe", async () => {
    let recibido: unknown;
    const { useCase } = build({
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
    const { useCase } = build({
      obtenerInforme: async (_i: unknown, t: number) => {
        timeout = t;

        return INFORME;
      },
    });

    await useCase.execute({ solicitudId: "sol-1" });

    assert.equal(timeout, 90000);
  });

  it("throws cuando la solicitud no existe", async () => {
    const { useCase } = build({ obtenerInforme: async () => INFORME }, {
      solicitud: null,
    });

    await assert.rejects(
      () => useCase.execute({ solicitudId: "sol-1" }),
      SolicitudCoreNotFoundError,
    );
  });

  it("devuelve null cuando no se pudo consultar", async () => {
    // Para la pestaña "no se pudo" es un estado valido, no un error 500.
    const { useCase } = build({ obtenerInforme: async () => null });

    assert.equal(await useCase.execute({ solicitudId: "sol-1" }), null);
  });

  it("devuelve el guardado sin consultar a Kestra si esta vigente", async () => {
    let consultado = false;
    const { useCase } = build(
      {
        obtenerInforme: async () => {
          consultado = true;

          return INFORME;
        },
      },
      { guardado: guardadoHace(6) },
    );

    const informe = await useCase.execute({ solicitudId: "sol-1" });

    assert.equal(consultado, false);
    assert.deepEqual(informe?.informe, { persona: { nombre_completo: "GUARDADO" } });
    assert.equal(informe?.ok, true);
    // cacheHit hace que la pestaña muestre la fecha del informe.
    assert.equal(informe?.cacheHit, true);
    assert.equal(informe?.cachedAt, guardadoHace(6).consultadoEn.toISOString());
  });

  it("vuelve a consultar y pisa el guardado cuando vencio", async () => {
    const { guardados, useCase } = build(
      { obtenerInforme: async () => INFORME },
      { guardado: guardadoHace(8) },
    );

    const informe = await useCase.execute({ solicitudId: "sol-1" });

    assert.deepEqual(informe?.informe, INFORME.informe);
    assert.equal(guardados.length, 1);
    assert.equal(guardados[0]?.solicitudId, "sol-1");
  });

  it("guarda el informe consultado cuando no habia ninguno", async () => {
    const { guardados, useCase } = build({ obtenerInforme: async () => INFORME });

    await useCase.execute({ solicitudId: "sol-1" });

    assert.equal(guardados.length, 1);
    assert.deepEqual(guardados[0]?.informe.informe, INFORME.informe);
  });

  it("no guarda una respuesta sin informe", async () => {
    const sinResultados = { ...INFORME, informe: null, status: "none" };
    const { guardados, useCase } = build({
      obtenerInforme: async () => sinResultados,
    });

    const informe = await useCase.execute({ solicitudId: "sol-1" });

    assert.equal(guardados.length, 0);
    assert.equal(informe?.status, "none");
  });

  it("si Kestra no responde devuelve el guardado aunque haya vencido", async () => {
    const { useCase } = build(
      { obtenerInforme: async () => null },
      { guardado: guardadoHace(30) },
    );

    const informe = await useCase.execute({ solicitudId: "sol-1" });

    assert.deepEqual(informe?.informe, { persona: { nombre_completo: "GUARDADO" } });
  });

  it("devuelve el informe aunque falle el guardado", async () => {
    const { useCase } = build(
      { obtenerInforme: async () => INFORME },
      { guardarFalla: true },
    );

    const informe = await useCase.execute({ solicitudId: "sol-1" });

    assert.deepEqual(informe?.informe, INFORME.informe);
  });
});

function build(
  gateway: unknown,
  opciones: {
    guardado?: InformeCredixsaGuardado | null;
    guardarFalla?: boolean;
    solicitud?: unknown;
  } = {},
) {
  const guardados: Array<{ informe: InformeCredixsaGuardado; solicitudId: string }> =
    [];
  const solicitud =
    opciones.solicitud === undefined ? solicitudPorDefecto() : opciones.solicitud;

  return {
    guardados,
    useCase: new GetCredixsaSolicitudUseCase({
      gateway: gateway as never,
      informes: {
        findBySolicitudId: async () => opciones.guardado ?? null,
        guardar: async (solicitudId, informe) => {
          if (opciones.guardarFalla) {
            throw new Error("base caida");
          }

          guardados.push({ informe, solicitudId });
        },
      },
      now: () => AHORA,
      repository: { findById: async () => solicitud } as never,
      timeoutMs: 90000,
    }),
  };
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
