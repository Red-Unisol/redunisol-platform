import type { EvaluateListSociosMutualGateway } from "../../infrastructure/services/EvaluateListSociosMutualGateway";
import {
  classifySocioMutualRow,
  type MappedSocioRow,
} from "../services/ClassifySocioMutualRow";
import { dedupeSociosKeepingMostRecent } from "../services/DedupeSociosKeepingMostRecent";

type Dependencies = {
  gateway: Pick<EvaluateListSociosMutualGateway, "fetchPage">;
};

export type PullSociosVimaxSummary = {
  fetched: number;
  inserted: number;
  skippedDuplicateCuit: number;
  skippedDuplicateNroDocumento: number;
  skippedIncompleteFisica: number;
  skippedMissingCuit: number;
};

export type PullSociosVimaxResult = {
  rows: MappedSocioRow[];
  summary: PullSociosVimaxSummary;
};

type PullSociosVimaxProgress = {
  cursor: number;
  fetchedInBatch: number;
  totalFetched: number;
};

type PullSociosVimaxInput = {
  batchSize: number;
  onProgress?: (progress: PullSociosVimaxProgress) => void;
  startId?: number;
};

export class PullSociosVimaxUseCase {
  private readonly gateway: Dependencies["gateway"];

  constructor(dependencies: Dependencies) {
    this.gateway = dependencies.gateway;
  }

  async execute(input: PullSociosVimaxInput): Promise<PullSociosVimaxResult> {
    const classifiedRows: MappedSocioRow[] = [];
    let fetched = 0;
    let skippedMissingCuit = 0;
    let skippedIncompleteFisica = 0;
    let cursor = input.startId ?? 0;

    for (;;) {
      const batch = await this.gateway.fetchPage(cursor, input.batchSize);

      if (batch.length === 0) {
        break;
      }

      fetched += batch.length;
      input.onProgress?.({
        cursor,
        fetchedInBatch: batch.length,
        totalFetched: fetched,
      });

      for (const row of batch) {
        const result = classifySocioMutualRow(row);

        if (!result.ok) {
          if (result.reason === "missing_cuit") {
            skippedMissingCuit += 1;
          } else {
            skippedIncompleteFisica += 1;
          }
          continue;
        }

        classifiedRows.push(result.row);
      }

      cursor = batch.reduce(
        (maxId, row) => (row.id !== null && row.id > maxId ? row.id : maxId),
        cursor,
      );

      if (batch.length < input.batchSize) {
        break;
      }
    }

    // Deduplicar recien al final (no en streaming, pagina por pagina): Vimax
    // no garantiza que un duplicado de CUIT/documento caiga en la misma
    // pagina que su par, asi que hace falta ver el conjunto completo para
    // decidir cual de los dos es el mas reciente.
    const { rows, skippedDuplicateCuit, skippedDuplicateNroDocumento } =
      dedupeSociosKeepingMostRecent(classifiedRows);

    return {
      rows,
      summary: {
        fetched,
        inserted: rows.length,
        skippedDuplicateCuit,
        skippedDuplicateNroDocumento,
        skippedIncompleteFisica,
        skippedMissingCuit,
      },
    };
  }
}
