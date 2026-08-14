import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SocioMutualPullRow } from "../../infrastructure/services/EvaluateListSociosMutualGateway";
import { PullSociosVimaxUseCase } from "./PullSociosVimax.use-case";

function buildRow(overrides: Partial<SocioMutualPullRow>): SocioMutualPullRow {
  return {
    apellido: null,
    celular: null,
    cuit: null,
    email: null,
    fechaDeNacimiento: null,
    id: null,
    nombre: null,
    nombreCompleto: null,
    nroDoc: null,
    sexo: null,
    tipoDocDescripcion: null,
    ...overrides,
  };
}

function buildFisicaRow(overrides: Partial<SocioMutualPullRow>): SocioMutualPullRow {
  return buildRow({
    apellido: "Perez",
    fechaDeNacimiento: "1985-03-10",
    nombre: "Juan",
    sexo: "1",
    tipoDocDescripcion: "DNI",
    ...overrides,
  });
}

function fakeGateway(pages: Map<number, SocioMutualPullRow[]>) {
  const capturedCursors: number[] = [];

  return {
    capturedCursors,
    fetchPage: async (cursorId: number, _batchSize: number) => {
      capturedCursors.push(cursorId);
      return pages.get(cursorId) ?? [];
    },
  };
}

describe("PullSociosVimaxUseCase", () => {
  it("paginates by id cursor, maps, and keeps the most recent row per duplicate cuit/nroDocumento", async () => {
    const pages = new Map<number, SocioMutualPullRow[]>([
      [
        0,
        [
          buildFisicaRow({ id: 1, cuit: "20409126419", nroDoc: "40912641" }),
          buildRow({
            apellido: "Constructora SA",
            cuit: "30712345678",
            id: 2,
            tipoDocDescripcion: "CUIT",
          }),
          buildRow({ cuit: null, id: 3 }),
          buildFisicaRow({ id: 4, cuit: "20409126420", fechaDeNacimiento: null }),
        ],
      ],
      [
        4,
        [
          // Mismo cuit que id=1, ID mas alto -> este debe ganar.
          buildFisicaRow({
            apellido: "PerezActualizado",
            id: 5,
            cuit: "20409126419",
            nroDoc: "99999999",
          }),
          // nroDocumento repetido de id=1 (ya perdio contra id=5), cuit nuevo.
          buildFisicaRow({ id: 6, cuit: "20409126421", nroDoc: "40912641" }),
        ],
      ],
    ]);
    const gateway = fakeGateway(pages);
    const useCase = new PullSociosVimaxUseCase({ gateway });

    const result = await useCase.execute({ batchSize: 4 });

    assert.deepEqual(gateway.capturedCursors, [0, 4]);
    assert.equal(result.summary.fetched, 6);
    assert.equal(result.summary.skippedMissingCuit, 1);
    assert.equal(result.summary.skippedIncompleteFisica, 1);
    assert.equal(result.summary.inserted, 3);
    assert.equal(result.summary.skippedDuplicateCuit, 1);
    // id=5 (nroDoc 99999999) sobrevive el paso por cuit; id=6 (nroDoc
    // 40912641) queda como el unico con ese documento ya que id=1 perdio
    // antes por cuit -- no hay choque de documento en esta corrida.
    assert.equal(result.summary.skippedDuplicateNroDocumento, 0);
    const byCuit = new Map(
      result.rows.map((row) => [row.cuit, row.apellido ?? row.razonSocial]),
    );
    assert.deepEqual(
      byCuit,
      new Map([
        ["20409126419", "PerezActualizado"],
        ["30712345678", "Constructora SA"],
        ["20409126421", "Perez"],
      ]),
    );
  });

  it("stops immediately when the first page is empty", async () => {
    const gateway = fakeGateway(new Map());
    const useCase = new PullSociosVimaxUseCase({ gateway });

    const result = await useCase.execute({ batchSize: 500 });

    assert.equal(result.summary.fetched, 0);
    assert.deepEqual(result.rows, []);
  });

  it("starts pagination from the given startId", async () => {
    const pages = new Map<number, SocioMutualPullRow[]>([
      [1000, [buildFisicaRow({ id: 1001, cuit: "20409126419" })]],
    ]);
    const gateway = fakeGateway(pages);
    const useCase = new PullSociosVimaxUseCase({ gateway });

    await useCase.execute({ batchSize: 500, startId: 1000 });

    assert.deepEqual(gateway.capturedCursors, [1000]);
  });

  it("reports progress per fetched page", async () => {
    const pages = new Map<number, SocioMutualPullRow[]>([
      [0, [buildFisicaRow({ id: 1, cuit: "20409126419" })]],
    ]);
    const gateway = fakeGateway(pages);
    const useCase = new PullSociosVimaxUseCase({ gateway });
    const progressCalls: unknown[] = [];

    await useCase.execute({
      batchSize: 500,
      onProgress: (info) => progressCalls.push(info),
    });

    assert.deepEqual(progressCalls, [
      { cursor: 0, fetchedInBatch: 1, totalFetched: 1 },
    ]);
  });
});
