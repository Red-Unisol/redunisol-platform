import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LocalidadLegacy } from "../../infrastructure/services/EvaluateListLocalidadesGateway";
import { ListLocalidadesUseCase } from "./ListLocalidades.use-case";

function localidad(
  id: string,
  nombre: string,
  provincia: string,
  codigoPostal: string | null = null,
): LocalidadLegacy {
  return { codigoPostal, id, nombre, provincia };
}

const LOCALIDADES = [
  localidad("3", "VILLA MARIA", "CORDOBA", "5900"),
  localidad("2", "ALBERDI", "TUCUMAN", "4158"),
  localidad("1", "ALBERDI", "CORDOBA", "5000"),
  localidad("4", "CHUÑA", "CORDOBA", "521801"),
];

function buildUseCase() {
  return new ListLocalidadesUseCase({
    gateway: { fetchAll: async () => LOCALIDADES },
  });
}

describe("ListLocalidadesUseCase", () => {
  it("searches by every word in nombre, provincia or codigo postal, sorted", async () => {
    const useCase = buildUseCase();

    assert.deepEqual(
      (await useCase.execute({ limit: 50, search: "alberdi" })).map(
        (item) => item.id,
      ),
      ["1", "2"],
    );
    assert.deepEqual(
      (await useCase.execute({ limit: 50, search: "alberdi cord" })).map(
        (item) => item.id,
      ),
      ["1"],
    );
    assert.deepEqual(
      (await useCase.execute({ limit: 50, search: "5900" })).map(
        (item) => item.id,
      ),
      ["3"],
    );
  });

  it("puts the exact nombre first, then the ones that start with the search", async () => {
    const useCase = new ListLocalidadesUseCase({
      gateway: {
        fetchAll: async () => [
          localidad("1", "PUEBLO ALBERDI", "CORDOBA"),
          localidad("2", "ALBERDI NORTE", "TUCUMAN"),
          localidad("3", "ALBERDI", "CORDOBA"),
        ],
      },
    });

    const result = await useCase.execute({ limit: 50, search: "alberdi" });

    assert.deepEqual(
      result.map((item) => item.id),
      ["3", "2", "1"],
    );
  });

  it("ignores accents and case", async () => {
    const result = await buildUseCase().execute({ limit: 50, search: "chuna" });

    assert.deepEqual(result, [localidad("4", "CHUÑA", "CORDOBA", "521801")]);
  });

  it("returns nothing for an empty search and respects the limit", async () => {
    const useCase = buildUseCase();

    assert.deepEqual(await useCase.execute({ limit: 50, search: "  " }), []);
    assert.equal(
      (await useCase.execute({ limit: 1, search: "cordoba" })).length,
      1,
    );
  });

  it("finds localidades by id", async () => {
    const result = await buildUseCase().execute({ ids: ["2", "99"], limit: 50 });

    assert.deepEqual(result, [localidad("2", "ALBERDI", "TUCUMAN", "4158")]);
  });

  it("caches the list until the ttl expires", async () => {
    let calls = 0;
    let now = 0;
    const useCase = new ListLocalidadesUseCase({
      cacheTtlMs: 1000,
      gateway: {
        fetchAll: async () => {
          calls += 1;
          return LOCALIDADES;
        },
      },
      now: () => now,
    });

    await Promise.all([
      useCase.execute({ limit: 50, search: "a" }),
      useCase.execute({ limit: 50, search: "b" }),
    ]);
    now = 999;
    await useCase.execute({ limit: 50, search: "a" });
    assert.equal(calls, 1);

    now = 1000;
    await useCase.execute({ limit: 50, search: "a" });
    assert.equal(calls, 2);
  });

  it("does not cache a failure", async () => {
    let calls = 0;
    const useCase = new ListLocalidadesUseCase({
      gateway: {
        fetchAll: async () => {
          calls += 1;

          if (calls === 1) {
            throw new Error("Vimarx caido");
          }

          return LOCALIDADES;
        },
      },
    });

    await assert.rejects(() => useCase.execute({ limit: 50, search: "a" }));
    const result = await useCase.execute({ limit: 50, search: "villa" });

    assert.equal(result.length, 1);
    assert.equal(calls, 2);
  });
});
