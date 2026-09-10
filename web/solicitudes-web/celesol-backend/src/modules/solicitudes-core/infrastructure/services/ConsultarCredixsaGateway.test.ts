import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConsultarCredixsaGateway } from "./ConsultarCredixsaGateway";

const CONFIG = {
  timeoutMs: 5000,
  webhookUrl: "https://kestra.example.test/webhook/clave",
};

const INPUT = {
  cuit: "20359661305",
  nombre: "SALLITTO NICOLAS",
  solicitudId: "sol-1",
};

describe("ConsultarCredixsaGateway", () => {
  it("dispara el webhook con el cuerpo que espera el flow", async () => {
    let url: string | undefined;
    let body: unknown;
    const gateway = new ConsultarCredixsaGateway(CONFIG, async (i, init) => {
      url = String(i);
      body = JSON.parse(String(init?.body));

      return { json: async () => ({}), ok: true };
    });

    await gateway.consultar(INPUT);

    assert.equal(url, "https://kestra.example.test/webhook/clave");
    assert.deepEqual(body, {
      cuit: "20359661305",
      nombre: "SALLITTO NICOLAS",
      solicitud_id: "sol-1",
    });
  });

  it("no hace nada si el webhook no esta configurado", async () => {
    // Asi queda deshabilitado en cualquier ambiente que no lo configure.
    let llamado = false;
    const gateway = new ConsultarCredixsaGateway(
      { ...CONFIG, webhookUrl: "" },
      async () => {
        llamado = true;

        return { json: async () => ({}), ok: true };
      },
    );

    await gateway.consultar(INPUT);

    assert.equal(llamado, false);
  });

  it("no llama cuando no hay ni identificador ni nombre", async () => {
    let llamado = false;
    const gateway = new ConsultarCredixsaGateway(CONFIG, async () => {
      llamado = true;

      return { json: async () => ({}), ok: true };
    });

    await gateway.consultar({ cuit: "", nombre: "  ", solicitudId: "sol-1" });

    assert.equal(llamado, false);
  });

  it("no propaga el error cuando Kestra falla", async () => {
    // Lo mas importante del gateway: una consulta caida no puede
    // impedir que se guarde una solicitud.
    const gateway = new ConsultarCredixsaGateway(CONFIG, async () => {
      throw new Error("kestra caido");
    });

    await assert.doesNotReject(() => gateway.consultar(INPUT));
  });

  it("no propaga el error cuando el webhook responde mal", async () => {
    const gateway = new ConsultarCredixsaGateway(CONFIG, async () => ({
      json: async () => ({}),
      ok: false,
    }));

    await assert.doesNotReject(() => gateway.consultar(INPUT));
  });
});

describe("ConsultarCredixsaGateway.obtenerInforme", () => {
  it("mapea las salidas del flow y parsea el informe", async () => {
    // normalized_json llega como string JSON, no como objeto: si el flow
    // cambiara eso, la pestaña quedaria vacia sin ningun error visible.
    const gateway = new ConsultarCredixsaGateway(CONFIG, async () => ({
      json: async () => ({
        cache_hit: true,
        cached_at: "2026-09-10T18:00:00",
        cuit: "20359661305",
        error: "",
        nombre: "SALLITTO NICOLAS",
        normalized_json: '{"persona":{"nombre_completo":"SALLITTO NICOLAS"}}',
        ok: true,
        status: "single",
      }),
      ok: true,
    }));

    const informe = await gateway.obtenerInforme(INPUT, 90000);

    assert.equal(informe?.ok, true);
    assert.equal(informe?.cacheHit, true);
    assert.equal(informe?.status, "single");
    assert.deepEqual(informe?.informe, {
      persona: { nombre_completo: "SALLITTO NICOLAS" },
    });
  });

  it("devuelve el informe en null si el JSON viene roto", async () => {
    const gateway = new ConsultarCredixsaGateway(CONFIG, async () => ({
      json: async () => ({ normalized_json: "{roto", ok: true }),
      ok: true,
    }));

    const informe = await gateway.obtenerInforme(INPUT, 90000);

    assert.equal(informe?.ok, true);
    assert.equal(informe?.informe, null);
  });

  it("devuelve null cuando Kestra falla, sin propagar el error", async () => {
    const gateway = new ConsultarCredixsaGateway(CONFIG, async () => {
      throw new Error("kestra caido");
    });

    assert.equal(await gateway.obtenerInforme(INPUT, 90000), null);
  });

  it("devuelve null si el webhook no esta configurado", async () => {
    const gateway = new ConsultarCredixsaGateway(
      { ...CONFIG, webhookUrl: "" },
      async () => ({ json: async () => ({}), ok: true }),
    );

    assert.equal(await gateway.obtenerInforme(INPUT, 90000), null);
  });
});

