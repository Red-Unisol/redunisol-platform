import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConsultarCredixsaAlCrearSolicitud } from "./ConsultarCredixsaAlCrearSolicitud";
import type { InformeCredixsaGuardado } from "../../domain/repositories/SolicitudCredixsaInformeRepository";
import type { InformeCredixsa } from "../../infrastructure/services/ConsultarCredixsaGateway";

const AHORA = new Date("2026-09-11T12:00:00.000Z");

const INFORME: InformeCredixsa = {
  cachedAt: "2026-09-10T18:00:00.123456+00:00",
  cacheHit: true,
  cuit: "20359661305",
  error: "",
  informe: { persona: { nombre_completo: "SALLITTO NICOLAS" } },
  nombre: "SALLITTO NICOLAS",
  ok: true,
  status: "single",
};

const TITULAR = {
  apellidoDenominacion: "SALLITTO",
  cuit: "20-35966130-5",
  nombre: "NICOLAS",
  nroDocumento: "35966130",
};

describe("ConsultarCredixsaAlCrearSolicitud", () => {
  it("prefiere el CUIL cuando el titular lo tiene", async () => {
    // La cache de CredixSA se indexa por CUIL de 11 digitos: consultar con el
    // documento guardaria el informe solo bajo la clave por nombre.
    const { enviado, servicio } = build();

    await servicio.execute("sol-1", TITULAR);

    assert.equal(enviado()?.cuit, "20359661305");
    assert.equal(enviado()?.nombre, "SALLITTO NICOLAS");
    assert.equal(enviado()?.solicitudId, "sol-1");
  });

  it("usa el documento cuando no hay CUIL", async () => {
    const { enviado, servicio } = build();

    await servicio.execute("sol-1", {
      ...TITULAR,
      cuit: null,
      nroDocumento: "35.966.130",
    });

    assert.equal(enviado()?.cuit, "35966130");
  });

  it("manda solo el nombre cuando no hay ningun numero", async () => {
    const { enviado, servicio } = build();

    await servicio.execute("sol-1", {
      ...TITULAR,
      cuit: null,
      nroDocumento: null,
    });

    assert.equal(enviado()?.cuit, "");
    assert.equal(enviado()?.nombre, "SALLITTO NICOLAS");
  });

  it("descarta un CUIL que no tiene 11 digitos y cae al documento", async () => {
    const { enviado, servicio } = build();

    await servicio.execute("sol-1", { ...TITULAR, cuit: "2035966" });

    assert.equal(enviado()?.cuit, "35966130");
  });

  it("arma el nombre aunque falte el nombre de pila", async () => {
    const { enviado, servicio } = build();

    await servicio.execute("sol-1", {
      apellidoDenominacion: "MUTUAL CELESOL",
      cuit: null,
      nombre: null,
      nroDocumento: null,
    });

    assert.equal(enviado()?.nombre, "MUTUAL CELESOL");
  });

  it("espera la respuesta con el timeout configurado", async () => {
    const { servicio, timeout } = build();

    await servicio.execute("sol-1", TITULAR);

    assert.equal(timeout(), 300000);
  });

  it("guarda el informe que devuelve CredixSA", async () => {
    const { guardados, servicio } = build(INFORME);

    await servicio.execute("sol-1", TITULAR);

    assert.equal(guardados.length, 1);
    assert.equal(guardados[0]?.solicitudId, "sol-1");
    assert.deepEqual(guardados[0]?.informe.informe, INFORME.informe);
    // La fecha es la del informe en CredixSA, no la de hoy.
    assert.equal(
      guardados[0]?.informe.consultadoEn.toISOString(),
      "2026-09-10T18:00:00.123Z",
    );
  });

  it("no guarda nada si no se pudo consultar", async () => {
    const { guardados, servicio } = build(null);

    await servicio.execute("sol-1", TITULAR);

    assert.equal(guardados.length, 0);
  });

  it("no guarda una respuesta sin informe", async () => {
    // CredixSA no encontro a la persona: se vuelve a intentar la proxima vez
    // en vez de dejar guardado un "sin resultados".
    const { guardados, servicio } = build({
      ...INFORME,
      informe: null,
      status: "none",
    });

    await servicio.execute("sol-1", TITULAR);

    assert.equal(guardados.length, 0);
  });
});

function build(respuesta: InformeCredixsa | null = null) {
  let recibido: { cuit: string; nombre: string; solicitudId: string } | undefined;
  let timeoutRecibido: number | undefined;
  const guardados: Array<{ informe: InformeCredixsaGuardado; solicitudId: string }> =
    [];

  return {
    enviado: () => recibido,
    guardados,
    servicio: new ConsultarCredixsaAlCrearSolicitud({
      gateway: {
        obtenerInforme: async (input, timeoutMs) => {
          recibido = input;
          timeoutRecibido = timeoutMs;

          return respuesta;
        },
      },
      informes: {
        guardar: async (solicitudId, informe) => {
          guardados.push({ informe, solicitudId });
        },
      },
      now: () => AHORA,
      timeoutMs: 300000,
    }),
    timeout: () => timeoutRecibido,
  };
}
