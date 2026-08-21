import type { SocioLegacySyncRepository } from "../../domain/repositories/SocioLegacySyncRepository";
import type {
  PullSociosVimaxSummary,
  PullSociosVimaxUseCase,
} from "./PullSociosVimax.use-case";

const DEFAULT_BATCH_SIZE = 500;

type Dependencies = {
  pullSociosVimaxUseCase: Pick<PullSociosVimaxUseCase, "execute">;
  repository: SocioLegacySyncRepository;
};

type SyncSociosFromVimaxInput = {
  batchSize?: number;
};

export type SyncSociosFromVimaxResult = PullSociosVimaxSummary & {
  upserted: number;
};

export class SyncSociosFromVimaxUseCase {
  private readonly pullSociosVimaxUseCase: Dependencies["pullSociosVimaxUseCase"];
  private readonly repository: Dependencies["repository"];

  constructor(dependencies: Dependencies) {
    this.pullSociosVimaxUseCase = dependencies.pullSociosVimaxUseCase;
    this.repository = dependencies.repository;
  }

  async execute(
    input: SyncSociosFromVimaxInput = {},
  ): Promise<SyncSociosFromVimaxResult> {
    const { rows, summary } = await this.pullSociosVimaxUseCase.execute({
      batchSize: input.batchSize ?? DEFAULT_BATCH_SIZE,
    });

    const upserted = await this.repository.upsertManyFromLegacy(rows);

    return { ...summary, upserted };
  }
}
