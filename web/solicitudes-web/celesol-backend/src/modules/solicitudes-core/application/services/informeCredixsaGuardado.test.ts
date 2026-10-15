import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  desdeGuardado,
  estaVigente,
  paraGuardar,
  VIGENCIA_INFORME_CREDIXSA_MS,
} from "./informeCredixsaGuardado";
import type { InformeCredixsa } from "../../infrastructure/services/ConsultarCredixsaGateway";

const AHORA = new Date("2026-09-11T12:00:00.000Z");

const INFORME: InformeCredixsa = {
  // Formato real: datetime.isoformat() de Python, con microsegundos.
  cachedAt: "2026-09-10T18:00:00.123456+00:00",
  cacheHit: true,
  cuit: "20359661305",
  error: "",
  informe: { persona: { nombre_completo: "SALLITTO NICOLAS" } },
  nombre: "SALLITTO NICOLAS",
  ok: true,
  status: "single",
};

describe("paraGuardar", () => {
  it("toma la fecha del informe en CredixSA", () => {
    const guardado = paraGuardar(INFORME, AHORA);

    assert.equal(guardado?.consultadoEn.toISOString(), "2026-09-10T18:00:00.123Z");
    assert.deepEqual(guardado?.informe, INFORME.informe);
    assert.equal(guardado?.cuit, "20359661305");
    assert.equal(guardado?.status, "single");
  });

  it("usa la hora actual si el informe no trae fecha o no se entiende", () => {
    assert.equal(paraGuardar({ ...INFORME, cachedAt: "" }, AHORA)?.consultadoEn, AHORA);
    assert.equal(
      paraGuardar({ ...INFORME, cachedAt: "cualquiera" }, AHORA)?.consultadoEn,
      AHORA,
    );
  });

  it("no guarda si la consulta no salio bien o no hay informe", () => {
    assert.equal(paraGuardar(null, AHORA), null);
    assert.equal(paraGuardar({ ...INFORME, ok: false }, AHORA), null);
    assert.equal(paraGuardar({ ...INFORME, informe: null }, AHORA), null);
    assert.equal(paraGuardar({ ...INFORME, informe: "texto" }, AHORA), null);
  });
});

describe("estaVigente", () => {
  it("vale siete dias desde que CredixSA genero el informe", () => {
    const guardado = paraGuardar(INFORME, AHORA)!;
    const justoAntes = new Date(
      guardado.consultadoEn.getTime() + VIGENCIA_INFORME_CREDIXSA_MS - 1,
    );
    const justoAlVencer = new Date(
      guardado.consultadoEn.getTime() + VIGENCIA_INFORME_CREDIXSA_MS,
    );

    assert.equal(estaVigente(guardado, justoAntes), true);
    assert.equal(estaVigente(guardado, justoAlVencer), false);
  });
});

describe("desdeGuardado", () => {
  it("devuelve la misma forma que la respuesta de Kestra", () => {
    const guardado = paraGuardar(INFORME, AHORA)!;

    assert.deepEqual(desdeGuardado(guardado), {
      cachedAt: "2026-09-10T18:00:00.123Z",
      cacheHit: true,
      cuit: "20359661305",
      error: "",
      informe: INFORME.informe,
      nombre: "SALLITTO NICOLAS",
      ok: true,
      status: "single",
    });
  });
});
