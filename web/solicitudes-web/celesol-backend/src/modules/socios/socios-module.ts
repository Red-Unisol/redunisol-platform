import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import type { GetCurrentUserUseCase } from "../auth/application/use-cases/GetCurrentUser.use-case";
import { CheckSocioCuitDuplicateUseCase } from "./application/use-cases/CheckSocioCuitDuplicate.use-case";
import { CheckSocioDocumentoDuplicateUseCase } from "./application/use-cases/CheckSocioDocumentoDuplicate.use-case";
import { CreateSocioUseCase } from "./application/use-cases/CreateSocio.use-case";
import { DeleteSocioUseCase } from "./application/use-cases/DeleteSocio.use-case";
import { GetSocioByIdUseCase } from "./application/use-cases/GetSocioById.use-case";
import { ListSociosUseCase } from "./application/use-cases/ListSocios.use-case";
import { LookupSocioByDocumentoUseCase } from "./application/use-cases/LookupSocioByDocumento.use-case";
import { PullSociosVimaxUseCase } from "./application/use-cases/PullSociosVimax.use-case";
import { SyncSociosFromVimaxUseCase } from "./application/use-cases/SyncSociosFromVimax.use-case";
import { UpdateSocioUseCase } from "./application/use-cases/UpdateSocio.use-case";
import { CrearSocioMutualGateway } from "./infrastructure/services/CrearSocioMutualGateway";
import { EvaluateListSociosMutualGateway } from "./infrastructure/services/EvaluateListSociosMutualGateway";
import { SociosPrismaDatasource } from "./infrastructure/datasources/SociosPrismaDatasource";
import { SocioRepositoryImpl } from "./infrastructure/repositories/SocioRepositoryImpl";
import { SociosController } from "./presentation/SociosController";
import { SociosRoutes } from "./presentation/SociosRoutes";

type CreateSociosRouterDependencies = {
  getCurrentUserUseCase: GetCurrentUserUseCase;
};

export function createSociosRouter(
  dependencies: CreateSociosRouterDependencies,
) {
  const sociosDatasource = new SociosPrismaDatasource(prisma);
  const sociosRepository = new SocioRepositoryImpl(sociosDatasource);
  const crearSocioMutualGateway = new CrearSocioMutualGateway({
    baseUrl: env.LEGACY_API_BASE_URL,
    timeoutMs: env.LEGACY_API_TIMEOUT_MS,
  });
  const evaluateListSociosMutualGateway = new EvaluateListSociosMutualGateway({
    baseUrl: env.LEGACY_API_BASE_URL,
    timeoutMs: env.LEGACY_API_TIMEOUT_MS,
  });
  const checkSocioCuitDuplicateUseCase = new CheckSocioCuitDuplicateUseCase({
    repository: sociosRepository,
  });
  const checkSocioDocumentoDuplicateUseCase =
    new CheckSocioDocumentoDuplicateUseCase({
      repository: sociosRepository,
    });
  const createSocioUseCase = new CreateSocioUseCase({
    crearSocioMutualGateway,
    repository: sociosRepository,
  });
  const deleteSocioUseCase = new DeleteSocioUseCase({
    repository: sociosRepository,
  });
  const getSocioByIdUseCase = new GetSocioByIdUseCase({
    repository: sociosRepository,
  });
  const listSociosUseCase = new ListSociosUseCase({
    repository: sociosRepository,
  });
  const lookupSocioByDocumentoUseCase = new LookupSocioByDocumentoUseCase({
    repository: sociosRepository,
  });
  const updateSocioUseCase = new UpdateSocioUseCase({
    repository: sociosRepository,
  });
  const pullSociosVimaxUseCase = new PullSociosVimaxUseCase({
    gateway: evaluateListSociosMutualGateway,
  });
  const syncSociosFromVimaxUseCase = new SyncSociosFromVimaxUseCase({
    pullSociosVimaxUseCase,
    repository: sociosRepository,
  });
  const sociosController = new SociosController({
    checkSocioCuitDuplicateUseCase,
    checkSocioDocumentoDuplicateUseCase,
    createSocioUseCase,
    deleteSocioUseCase,
    getCurrentUserUseCase: dependencies.getCurrentUserUseCase,
    getSocioByIdUseCase,
    listSociosUseCase,
    lookupSocioByDocumentoUseCase,
    syncSociosFromVimaxUseCase,
    updateSocioUseCase,
  });

  return SociosRoutes.create(sociosController);
}
