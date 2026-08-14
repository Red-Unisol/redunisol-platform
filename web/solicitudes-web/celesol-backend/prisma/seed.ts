/**
 * Prisma seed entrypoint. Run via:
 *   npx prisma db seed
 *
 * 1. Upserts a generic system-admin account (bootstrap login, not tied to
 *    any real legacy user -- skips the normal registration/legacy-verification
 *    flow on purpose).
 * 2. Pulls every socio (persona fisica y juridica) live from the Vimax
 *    legacy SocioMutual master and upserts them into the `socios` table.
 *    Intentionally does not commit any socio data to the repo -- it always
 *    fetches fresh data from Vimax at seed time.
 */

import "dotenv/config";

import { env } from "../src/config/env";
import { prisma } from "../src/db/prisma";
import { BcryptPasswordHasher } from "../src/modules/auth/infrastructure/services/BcryptPasswordHasher";
import { PullSociosVimaxUseCase } from "../src/modules/socios/application/use-cases/PullSociosVimax.use-case";
import { SyncSociosFromVimaxUseCase } from "../src/modules/socios/application/use-cases/SyncSociosFromVimax.use-case";
import { SociosPrismaDatasource } from "../src/modules/socios/infrastructure/datasources/SociosPrismaDatasource";
import { SocioRepositoryImpl } from "../src/modules/socios/infrastructure/repositories/SocioRepositoryImpl";
import { EvaluateListSociosMutualGateway } from "../src/modules/socios/infrastructure/services/EvaluateListSociosMutualGateway";

const ADMIN_EMAIL = "administrador@celesol.dev";
const ADMIN_LEGACY_USER = "apajon";
const ADMIN_PASSWORD = "Password123!";
const ADMIN_WORKFLOW_OWNER_CODE = "VENDEDORES";

async function seedAdminUser() {
  const passwordHasher = new BcryptPasswordHasher();
  const passwordHash = await passwordHasher.hash(ADMIN_PASSWORD);
  const workflowOwner = await prisma.workflowOwner.findUnique({
    where: { code: ADMIN_WORKFLOW_OWNER_CODE },
  });

  if (!workflowOwner) {
    throw new Error(
      `No se encontro el workflow owner "${ADMIN_WORKFLOW_OWNER_CODE}" -- revisa el catalogo sembrado por la migracion.`,
    );
  }

  await prisma.user.upsert({
    create: {
      email: ADMIN_EMAIL,
      emailVerified: true,
      firstName: "Administrador",
      isSystemAdmin: true,
      lastName: "Celesol",
      legacyUser: ADMIN_LEGACY_USER,
      passwordHash,
      workflowOwnerId: workflowOwner.id,
    },
    update: {
      emailVerified: true,
      isSystemAdmin: true,
      legacyUser: ADMIN_LEGACY_USER,
      passwordHash,
      state: 1,
      workflowOwnerId: workflowOwner.id,
    },
    where: { email: ADMIN_EMAIL },
  });

  console.log(
    `Cuenta admin lista: ${ADMIN_EMAIL} / ${ADMIN_LEGACY_USER} (owner: ${workflowOwner.code})`,
  );
}

async function seedSociosFromVimax() {
  const gateway = new EvaluateListSociosMutualGateway({
    baseUrl: env.LEGACY_API_BASE_URL,
    timeoutMs: env.LEGACY_API_TIMEOUT_MS,
  });
  const repository = new SocioRepositoryImpl(new SociosPrismaDatasource(prisma));
  const pullSociosVimaxUseCase = new PullSociosVimaxUseCase({ gateway });
  const syncSociosFromVimaxUseCase = new SyncSociosFromVimaxUseCase({
    pullSociosVimaxUseCase,
    repository,
  });

  const result = await syncSociosFromVimaxUseCase.execute();

  console.log(
    `Socios sincronizados desde Vimax. Traidos=${result.fetched} Escritos=${result.upserted} ` +
      `SinCUIT=${result.skippedMissingCuit} ` +
      `FisicaIncompleta=${result.skippedIncompleteFisica} ` +
      `CUITDuplicado=${result.skippedDuplicateCuit} ` +
      `DocumentoDuplicado=${result.skippedDuplicateNroDocumento}`,
  );
}

async function main() {
  await seedAdminUser();
  await seedSociosFromVimax();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
