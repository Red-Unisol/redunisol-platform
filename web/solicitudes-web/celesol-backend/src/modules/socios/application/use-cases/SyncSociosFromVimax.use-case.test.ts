import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MappedSocioRow } from "../services/ClassifySocioMutualRow";
import type { PullSociosVimaxResult } from "./PullSociosVimax.use-case";
import { SyncSociosFromVimaxUseCase } from "./SyncSociosFromVimax.use-case";

function buildPullResult(overrides: Partial<PullSociosVimaxResult> = {}): PullSociosVimaxResult {
  return {
    rows: [],
    summary: {
      fetched: 0,
      inserted: 0,
      skippedDuplicateCuit: 0,
      skippedDuplicateNroDocumento: 0,
      skippedIncompleteFisica: 0,
      skippedMissingCuit: 0,
    },
    ...overrides,
  };
}

describe("SyncSociosFromVimaxUseCase", () => {
  it("pulls from Vimax, upserts the mapped rows, and returns summary + upserted count", async () => {
    const rows: MappedSocioRow[] = [
      {
        apellido: "Perez",
        celular: null,
        cuit: "20409126419",
        email: null,
        fechaDeNacimiento: "1985-03-10",
        nombre: "Juan",
        nroDocumento: "20409126",
        nroSocioLegacy: "1",
        razonSocial: null,
        sexo: "1",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      },
    ];
    const pullResult = buildPullResult({
      rows,
      summary: {
        fetched: 5,
        inserted: 1,
        skippedDuplicateCuit: 1,
        skippedDuplicateNroDocumento: 0,
        skippedIncompleteFisica: 2,
        skippedMissingCuit: 1,
      },
    });

    let capturedBatchSize: number | undefined;
    const pullSociosVimaxUseCase = {
      execute: async (input: { batchSize: number }) => {
        capturedBatchSize = input.batchSize;
        return pullResult;
      },
    };

    let capturedRows: MappedSocioRow[] | undefined;
    const repository = {
      upsertManyFromLegacy: async (upsertRows: MappedSocioRow[]) => {
        capturedRows = upsertRows;
        return upsertRows.length;
      },
    };

    const useCase = new SyncSociosFromVimaxUseCase({
      pullSociosVimaxUseCase,
      repository,
    });

    const result = await useCase.execute();

    assert.equal(capturedBatchSize, 500);
    assert.deepEqual(capturedRows, rows);
    assert.deepEqual(result, {
      fetched: 5,
      inserted: 1,
      skippedDuplicateCuit: 1,
      skippedDuplicateNroDocumento: 0,
      skippedIncompleteFisica: 2,
      skippedMissingCuit: 1,
      upserted: 1,
    });
  });

  it("passes through a custom batchSize", async () => {
    let capturedBatchSize: number | undefined;
    const pullSociosVimaxUseCase = {
      execute: async (input: { batchSize: number }) => {
        capturedBatchSize = input.batchSize;
        return buildPullResult();
      },
    };
    const repository = {
      upsertManyFromLegacy: async () => 0,
    };

    const useCase = new SyncSociosFromVimaxUseCase({
      pullSociosVimaxUseCase,
      repository,
    });

    await useCase.execute({ batchSize: 50 });

    assert.equal(capturedBatchSize, 50);
  });

  it("returns upserted 0 when the pull returns no rows", async () => {
    const pullSociosVimaxUseCase = {
      execute: async () => buildPullResult(),
    };
    const repository = {
      upsertManyFromLegacy: async (rows: MappedSocioRow[]) => rows.length,
    };

    const useCase = new SyncSociosFromVimaxUseCase({
      pullSociosVimaxUseCase,
      repository,
    });

    const result = await useCase.execute();

    assert.equal(result.upserted, 0);
  });
});
