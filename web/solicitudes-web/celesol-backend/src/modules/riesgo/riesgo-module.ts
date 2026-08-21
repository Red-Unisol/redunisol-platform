import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import type { GetCurrentUserUseCase } from "../auth/application/use-cases/GetCurrentUser.use-case";
import { CalculadoraMutualDatosProvider } from "./application/services/CalculadoraMutualDatosProvider";
import { SolicitudCoreSnapshotDatasource } from "./infrastructure/datasources/SolicitudCoreSnapshotDatasource";
import { CalculadoraMutualLegacyGateway } from "./infrastructure/services/CalculadoraMutualLegacyGateway";
import { RiesgoController } from "./presentation/RiesgoController";
import { RiesgoRoutes } from "./presentation/RiesgoRoutes";

type CreateRiesgoRouterDependencies = {
  getCurrentUserUseCase: GetCurrentUserUseCase;
};

export function createRiesgoRouter(
  dependencies: CreateRiesgoRouterDependencies,
) {
  const legacyGateway = new CalculadoraMutualLegacyGateway({
    baseUrl: env.LEGACY_API_BASE_URL,
    timeoutMs: env.LEGACY_API_TIMEOUT_MS,
  });
  const solicitudCoreSnapshotDatasource = new SolicitudCoreSnapshotDatasource(
    prisma,
  );
  const calculadoraMutualDatosProvider = new CalculadoraMutualDatosProvider({
    legacyGateway,
    solicitudCoreSnapshotDatasource,
  });

  const riesgoController = new RiesgoController({
    calculadoraMutualDatosProvider,
    getCurrentUserUseCase: dependencies.getCurrentUserUseCase,
  });

  return RiesgoRoutes.create(riesgoController);
}
