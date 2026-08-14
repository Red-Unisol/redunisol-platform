import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Socio } from "../../domain/entities/Socio.entity";
import { ListSociosUseCase } from "./ListSocios.use-case";

describe("ListSociosUseCase", () => {
  it("returns socios ordered by createdAt desc from the repository", async () => {
    const expected: Socio[] = [
      {
        apellido: null,
        celular: null,
        createdAt: new Date("2026-06-19T18:00:00.000Z"),
        cuit: "30123456789",
        domicilioCalle: null,
        domicilioCodigoPostal: null,
        domicilioLocalidad: null,
        domicilioNroPuerta: null,
        email: null,
        fechaDeNacimiento: null,
        id: "socio-2",
        nombre: null,
        nroDocumento: null,
        nroSocioLegacy: null,
        razonSocial: "ACME SA",
        sexo: null,
        tipoDocumento: null,
        tipoPersona: "JURIDICA",
        updatedAt: new Date("2026-06-19T18:00:00.000Z"),
      },
      {
        apellido: "Perez",
        celular: null,
        createdAt: new Date("2026-06-18T18:00:00.000Z"),
        cuit: "20123456783",
        domicilioCalle: null,
        domicilioCodigoPostal: null,
        domicilioLocalidad: null,
        domicilioNroPuerta: null,
        email: null,
        fechaDeNacimiento: new Date("1990-02-28T00:00:00.000Z"),
        id: "socio-1",
        nombre: "Juan",
        nroDocumento: "12345678",
        nroSocioLegacy: null,
        razonSocial: null,
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
        updatedAt: new Date("2026-06-18T18:00:00.000Z"),
      },
    ];

    const useCase = new ListSociosUseCase({
      repository: {
        count: async () => expected.length,
        list: async () => expected,
      },
    });

    const result = await useCase.execute({ limit: 20, offset: 0 });

    assert.deepEqual(result, { items: expected, total: expected.length });
  });

  it("returns total from the repository count, independent of the page size", async () => {
    const useCase = new ListSociosUseCase({
      repository: {
        count: async () => 137,
        list: async () => [],
      },
    });

    const result = await useCase.execute({ limit: 20, offset: 0 });

    assert.equal(result.total, 137);
  });
});
