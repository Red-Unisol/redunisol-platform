import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import type { GetCurrentUserUseCase } from "../auth/application/use-cases/GetCurrentUser.use-case";
import { MinioAdjuntosObjectStorage } from "../solicitudes-core/adjuntos/infrastructure/services/MinioAdjuntosObjectStorage";
import { CalculadoraMutualDatosProvider } from "./application/services/CalculadoraMutualDatosProvider";
import { CalculadoraVersionesUseCase } from "./application/use-cases/CalculadoraVersiones.use-case";
import { GetEvaluacionRiesgoUseCase } from "./application/use-cases/GetEvaluacionRiesgo.use-case";
import { GuardarEvaluacionRiesgoUseCase } from "./application/use-cases/GuardarEvaluacionRiesgo.use-case";
import { CalculadoraRiesgoVersionPrismaDatasource } from "./infrastructure/datasources/CalculadoraRiesgoVersionPrismaDatasource";
import { EvaluacionRiesgoPrismaDatasource } from "./infrastructure/datasources/EvaluacionRiesgoPrismaDatasource";
import { SolicitudCoreSnapshotDatasource } from "./infrastructure/datasources/SolicitudCoreSnapshotDatasource";
import { CalculadoraMutualLegacyGateway } from "./infrastructure/services/CalculadoraMutualLegacyGateway";
import { leerPlanillaRepositorio } from "./infrastructure/services/PlanillaRepositorio";
import { ScoringpfVimarxGateway } from "./infrastructure/services/ScoringpfVimarxGateway";
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

  // Mismo almacenamiento y bucket que los adjuntos: MinIO en dev, S3 en prod.
  const objectStorage = new MinioAdjuntosObjectStorage({
    accessKey: env.MINIO_ACCESS_KEY,
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    region: env.MINIO_REGION,
    secretKey: env.MINIO_SECRET_KEY,
    useSSL: env.MINIO_USE_SSL,
  });
  const evaluacionRiesgoRepository = new EvaluacionRiesgoPrismaDatasource(
    prisma,
  );

  // Versiones de la calculadora que Riesgo trae de Vimarx (SCORINGPF).
  const calculadoraVersiones = new CalculadoraRiesgoVersionPrismaDatasource(
    prisma,
  );
  const calculadoraVersionesUseCase = new CalculadoraVersionesUseCase({
    leerPlanillaRepositorio,
    now: () => new Date(),
    repository: calculadoraVersiones,
    vimarx: new ScoringpfVimarxGateway({
      baseUrl: env.LEGACY_API_BASE_URL,
      timeoutMs: env.LEGACY_API_TIMEOUT_MS,
    }),
  });

  const riesgoController = new RiesgoController({
    calculadoraMutualDatosProvider,
    calculadoraVersiones,
    calculadoraVersionesUseCase,
    getCurrentUserUseCase: dependencies.getCurrentUserUseCase,
    getEvaluacionRiesgoUseCase: new GetEvaluacionRiesgoUseCase({
      objectStorage,
      repository: evaluacionRiesgoRepository,
    }),
    guardarEvaluacionRiesgoUseCase: new GuardarEvaluacionRiesgoUseCase({
      now: () => new Date(),
      objectStorage,
      repository: evaluacionRiesgoRepository,
      storageBucket: env.MINIO_BUCKET_SOLICITUDES,
    }),
    leerPlanillaRepositorio,
  });

  return RiesgoRoutes.create(riesgoController);
}
