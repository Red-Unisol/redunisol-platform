import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PrecalentarCredixsaGateway } from "./PrecalentarCredixsaGateway";

const CONFIG = {
  timeoutMs: 5000,
  webhookUrl: "https://kestra.example.test/webhook/clave",
};

const INPUT = {
  cuit: "20359661305",
  nombre: "SALLITTO NICOLAS",
  solicitudId: "sol-1",
};

describe("PrecalentarCredixsaGateway", () => {
  it("dispara el webhook con el cuerpo que espera el flow", async () => {
    let url: string | undefined;
    let body: unknown;
    const gateway = new PrecalentarCredixsaGateway(CONFIG, async (i, init) => {
      url = String(i);
      body = JSON.parse(String(init?.body));

      return { ok: true };
    });

    await gateway.precalentar(INPUT);

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
    const gateway = new PrecalentarCredixsaGateway(
      { ...CONFIG, webhookUrl: "" },
      async () => {
        llamado = true;

        return { ok: true };
      },
    );

    await gateway.precalentar(INPUT);

    assert.equal(llamado, false);
  });

  it("no llama cuando no hay ni identificador ni nombre", async () => {
    let llamado = false;
    const gateway = new PrecalentarCredixsaGateway(CONFIG, async () => {
      llamado = true;

      return { ok: true };
    });

    await gateway.precalentar({ cuit: "", nombre: "  ", solicitudId: "sol-1" });

    assert.equal(llamado, false);
  });

  it("no propaga el error cuando Kestra falla", async () => {
    // Lo mas importante del gateway: un precalentamiento caido no puede
    // impedir que se guarde una solicitud.
    const gateway = new PrecalentarCredixsaGateway(CONFIG, async () => {
      throw new Error("kestra caido");
    });

    await assert.doesNotReject(() => gateway.precalentar(INPUT));
  });

  it("no propaga el error cuando el webhook responde mal", async () => {
    const gateway = new PrecalentarCredixsaGateway(CONFIG, async () => ({
      ok: false,
    }));

    await assert.doesNotReject(() => gateway.precalentar(INPUT));
  });
});
