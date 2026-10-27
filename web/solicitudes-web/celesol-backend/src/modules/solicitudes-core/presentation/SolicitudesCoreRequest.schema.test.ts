import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import {
  simularPrestamoBodySchema,
  listSolicitudesQuerySchema,
  createSolicitudBodySchema,
  patchSolicitudBodySchema,
  createPrestamoLegacyBodySchema,
} from "./SolicitudesCoreRequest.schema";

describe("createPrestamoLegacyBodySchema convenio patch", () => {
  it("accepts a single edit with its original value and preserves omitted fields", () => {
    assert.deepEqual(createPrestamoLegacyBodySchema.parse({ convenio: { caja40: { original: 100, valor: 110 } } }), {
      convenio: { caja40: { original: 100, valor: 110 } },
    });
    assert.deepEqual(createPrestamoLegacyBodySchema.parse({}), {});
    assert.deepEqual(createPrestamoLegacyBodySchema.parse({ convenio: {} }), { convenio: {} });
  });

  it("requires the original value and rejects the old full-snapshot format", () => {
    for (const convenio of [
      { caja40: { valor: 110 } }, { caja40: { original: 100 } },
      { beneficio: "733767/0", caja40: 100, convAux: null, observaciones: null },
      { campoDesconocido: { original: null, valor: "x" } },
      { caja40: { original: 100, valor: 110, extra: true } },
    ]) assert.equal(createPrestamoLegacyBodySchema.safeParse({ convenio }).success, false);
  });

  it("normalizes text and preserves null and zero without accepting invalid numbers", () => {
    assert.deepEqual(createPrestamoLegacyBodySchema.parse({ convenio: {
      beneficio: { original: " viejo ", valor: "  " }, convAux: { original: null, valor: 0 },
    } }), { convenio: { beneficio: { original: "viejo", valor: null }, convAux: { original: null, valor: 0 } } });
    for (const valor of [-1, 1.5, 2147483648, "110"])
      assert.equal(createPrestamoLegacyBodySchema.safeParse({ convenio: { caja40: { original: 100, valor } } }).success, false);
  });
});

function isoDateYearsAgo(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function minimalCreateBody(fechaNacimiento: string) {
  return {
    lineaPrestamoLegacyOid: "linea-1",
    datosLaborales: {},
    titular: {
      apellidoDenominacion: "Perez",
      nombre: "Juan",
      nroDocumento: "12345678",
      tipoDocumento: "DNI",
      fechaNacimiento,
    },
  };
}

describe("SolicitudesCoreRequest.schema", () => {
  describe("createSolicitudBodySchema titular.fechaNacimiento age bounds", () => {
    it("accepts a titular that just turned 18 today", () => {
      const result = createSolicitudBodySchema.safeParse(
        minimalCreateBody(isoDateYearsAgo(18)),
      );

      assert.equal(result.success, true);
    });

    it("accepts a titular that is 85 today", () => {
      const result = createSolicitudBodySchema.safeParse(
        minimalCreateBody(isoDateYearsAgo(85)),
      );

      assert.equal(result.success, true);
    });

    it("rejects a titular younger than 18", () => {
      const result = createSolicitudBodySchema.safeParse(
        minimalCreateBody(isoDateYearsAgo(10)),
      );

      assert.equal(result.success, false);
    });

    it("rejects a titular older than 85", () => {
      const result = createSolicitudBodySchema.safeParse(
        minimalCreateBody(isoDateYearsAgo(90)),
      );

      assert.equal(result.success, false);
    });
  });

  describe("patchSolicitudBodySchema titular.fechaNacimiento age bounds", () => {
    it("accepts a valid age", () => {
      const result = patchSolicitudBodySchema.safeParse({
        titular: { fechaNacimiento: isoDateYearsAgo(40) },
      });

      assert.equal(result.success, true);
    });

    it("accepts null", () => {
      const result = patchSolicitudBodySchema.safeParse({
        titular: { fechaNacimiento: null },
      });

      assert.equal(result.success, true);
    });

    it("rejects a titular younger than 18", () => {
      const result = patchSolicitudBodySchema.safeParse({
        titular: { fechaNacimiento: isoDateYearsAgo(5) },
      });

      assert.equal(result.success, false);
    });

    it("rejects a titular older than 85", () => {
      const result = patchSolicitudBodySchema.safeParse({
        titular: { fechaNacimiento: isoDateYearsAgo(100) },
      });

      assert.equal(result.success, false);
    });
  });
});

it("valida vista y no acepta owner del cliente", () => {
  for (const vista of ["mi-area", "todas"]) {
    const parsed = listSolicitudesQuerySchema.parse({ scope: "recientes", vista, estadoOwnerId: "ajeno" });
    assert.equal(parsed.vista, vista);
    assert.equal("estadoOwnerId" in parsed, false);
  }
  assert.equal(listSolicitudesQuerySchema.safeParse({ vista: "ajena" }).success, false);
});

it("normaliza la búsqueda de Recientes y limita su longitud", () => {
  assert.equal(listSolicitudesQuerySchema.parse({ scope: "recientes", search: "  Ramiro López  " }).search, "Ramiro López");
  assert.equal(listSolicitudesQuerySchema.safeParse({ search: "a".repeat(161) }).success, false);
});

it("rejects manual cuota resultante, including numeric values and null", () => {
  for (const cuotaResultante of ["1.313.847,24", "1000", "abc", null]) {
    assert.equal(patchSolicitudBodySchema.safeParse({ solicitud: { cuotaResultante } }).success, false);
    assert.equal(createSolicitudBodySchema.safeParse({ ...minimalCreateBody("1990-01-01"), cuotaResultante }).success, false);
  }
});

test("acepta cuota objetivo únicamente positiva y finita en simulación", () => {
  const base = { capitalPuro: false, cuotas: 12, lineaId: 1, montoAFinanciar: 1000 };
  assert.equal(simularPrestamoBodySchema.parse({ ...base, cuotaObjetivo: 100 }).cuotaObjetivo, 100);
  for (const cuotaObjetivo of [0, -1, Infinity, NaN, "letras"]) assert.equal(simularPrestamoBodySchema.safeParse({ ...base, cuotaObjetivo }).success, false);
});
