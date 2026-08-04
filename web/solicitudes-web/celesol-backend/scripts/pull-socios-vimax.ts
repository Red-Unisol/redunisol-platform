/**
 * Pulls every socio (persona fisica y juridica) from the Vimax legacy
 * SocioMutual master and writes a SQL seed file for the `socios` table.
 *
 * Read-only: never writes to any database. Run with:
 *   npx tsx scripts/pull-socios-vimax.ts [--base-url URL] [--batch-size N]
 *                                        [--start-id N] [--output PATH]
 */

import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { env } from "../src/config/env";
import { PullSociosVimaxUseCase } from "../src/modules/socios/application/use-cases/PullSociosVimax.use-case";
import { EvaluateListSociosMutualGateway } from "../src/modules/socios/infrastructure/services/EvaluateListSociosMutualGateway";
import { buildSociosSeedSql } from "../src/modules/socios/infrastructure/sql/BuildSociosSeedSql";

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_OUTPUT_PATH = resolve(__dirname, "out", "socios_seed.sql");

type CliArgs = {
  baseUrl: string;
  batchSize: number;
  output: string;
  startId: number;
  timeoutMs: number;
};

function parseArgs(argv: string[]): CliArgs {
  const raw: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token.startsWith("--")) {
      raw[token.slice(2)] = argv[i + 1];
      i += 1;
    }
  }

  return {
    baseUrl: raw["base-url"] ?? env.LEGACY_API_BASE_URL,
    batchSize: Number(raw["batch-size"] ?? DEFAULT_BATCH_SIZE),
    output: resolve(raw.output ?? DEFAULT_OUTPUT_PATH),
    startId: Number(raw["start-id"] ?? 0),
    timeoutMs: Number(raw["timeout-ms"] ?? env.LEGACY_API_TIMEOUT_MS),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gateway = new EvaluateListSociosMutualGateway({
    baseUrl: args.baseUrl,
    timeoutMs: args.timeoutMs,
  });
  const useCase = new PullSociosVimaxUseCase({ gateway });

  const result = await useCase.execute({
    batchSize: args.batchSize,
    onProgress: (progress) => {
      console.error(
        `fetched batch [ID]>${progress.cursor}: ${progress.fetchedInBatch} rows (total ${progress.totalFetched})`,
      );
    },
    startId: args.startId,
  });

  const sql = buildSociosSeedSql(result.rows);
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, sql, "utf8");

  console.log(
    `Listo. Traidos=${result.summary.fetched} Insertados=${result.summary.inserted} ` +
      `SinCUIT=${result.summary.skippedMissingCuit} ` +
      `FisicaIncompleta=${result.summary.skippedIncompleteFisica} ` +
      `CUITDuplicado=${result.summary.skippedDuplicateCuit} ` +
      `DocumentoDuplicado=${result.summary.skippedDuplicateNroDocumento}`,
  );
  console.log(`Seed escrito en: ${args.output}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
