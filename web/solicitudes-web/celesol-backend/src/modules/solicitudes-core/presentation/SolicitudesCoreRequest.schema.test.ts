import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  listSolicitudesQuerySchema,
  createSolicitudBodySchema,
  patchSolicitudBodySchema,
} from "./SolicitudesCoreRequest.schema";

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
