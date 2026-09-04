import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import type { GetCurrentUserUseCase } from "../auth/application/use-cases/GetCurrentUser.use-case";
import { AuthPrismaDatasource } from "../auth/infrastructure/datasources/AuthPrismaDatasource";
import { AuthRepositoryImpl } from "../auth/infrastructure/repositories/AuthRepositoryImpl";
import { SociosPrismaDatasource } from "../socios/infrastructure/datasources/SociosPrismaDatasource";
import { SocioRepositoryImpl } from "../socios/infrastructure/repositories/SocioRepositoryImpl";
import { EvaluateListSolicitudesGateway } from "../solicitudes/infrastructure/services/EvaluateListSolicitudesGateway";
import { PrestamosSimulacionGateway } from "../solicitudes/infrastructure/services/PrestamosSimulacionGateway";
import { DeleteSolicitudAdjuntoUseCase } from "./adjuntos/application/use-cases/DeleteSolicitudAdjunto.use-case";
import { DownloadSolicitudAdjuntoUseCase } from "./adjuntos/application/use-cases/DownloadSolicitudAdjunto.use-case";
import { ListSolicitudAdjuntosUseCase } from "./adjuntos/application/use-cases/ListSolicitudAdjuntos.use-case";
import { UpdateSolicitudAdjuntoUseCase } from "./adjuntos/application/use-cases/UpdateSolicitudAdjunto.use-case";
import { UploadSolicitudAdjuntoUseCase } from "./adjuntos/application/use-cases/UploadSolicitudAdjunto.use-case";
import { UploadSolicitudAdjuntosBatchUseCase } from "./adjuntos/application/use-cases/UploadSolicitudAdjuntosBatch.use-case";
import { SolicitudAdjuntosPrismaDatasource } from "./adjuntos/infrastructure/datasources/SolicitudAdjuntosPrismaDatasource";
import { SolicitudAdjuntoRepositoryImpl } from "./adjuntos/infrastructure/repositories/SolicitudAdjuntoRepositoryImpl";
import { MinioAdjuntosObjectStorage } from "./adjuntos/infrastructure/services/MinioAdjuntosObjectStorage";
import { SolicitudAdjuntosController } from "./adjuntos/presentation/SolicitudAdjuntosController";
import { CreateSolicitudCancelacionUseCase } from "./cancelaciones/application/use-cases/CreateSolicitudCancelacion.use-case";
import { DeleteSolicitudCancelacionUseCase } from "./cancelaciones/application/use-cases/DeleteSolicitudCancelacion.use-case";
import { ListSolicitudCancelacionesUseCase } from "./cancelaciones/application/use-cases/ListSolicitudCancelaciones.use-case";
import { UpdateSolicitudCancelacionUseCase } from "./cancelaciones/application/use-cases/UpdateSolicitudCancelacion.use-case";
import { SolicitudCancelacionesPrismaDatasource } from "./cancelaciones/infrastructure/datasources/SolicitudCancelacionesPrismaDatasource";
import { SolicitudCancelacionRepositoryImpl } from "./cancelaciones/infrastructure/repositories/SolicitudCancelacionRepositoryImpl";
import { SolicitudCancelacionesController } from "./cancelaciones/presentation/SolicitudCancelacionesController";
import { ChangeSolicitudStateUseCase } from "./application/use-cases/ChangeSolicitudState.use-case";
import { CreatePrestamoLegacyUseCase } from "./application/use-cases/CreatePrestamoLegacy.use-case";
import { SolicitudWorkflowCapabilitiesService } from "./application/services/SolicitudWorkflowCapabilitiesService";
import { AssignSolicitudToSelfUseCase } from "./application/use-cases/AssignSolicitudToSelf.use-case";
import { AssignSolicitudToUserUseCase } from "./application/use-cases/AssignSolicitudToUser.use-case";
import { CreateSolicitudUseCase } from "./application/use-cases/CreateSolicitud.use-case";
import { GetFieldAccessFieldCatalogUseCase } from "./application/use-cases/GetFieldAccessFieldCatalog.use-case";
import { GetFieldAccessRuleByStateUseCase } from "./application/use-cases/GetFieldAccessRuleByState.use-case";
import { GetWorkflowTransitionsByStateUseCase } from "./application/use-cases/GetWorkflowTransitionsByState.use-case";
import { GetSolicitudByIdUseCase } from "./application/use-cases/GetSolicitudById.use-case";
import { GetFinSolicitudDatosUseCase } from "./application/use-cases/GetFinSolicitudDatos.use-case";
import { GetSolicitudesStatsUseCase } from "./application/use-cases/GetSolicitudesStats.use-case";
import { GetVendedorDashboardStatsUseCase } from "./application/use-cases/GetVendedorDashboardStats.use-case";
import { GetAnalistaDashboardStatsUseCase } from "./application/use-cases/GetAnalistaDashboardStats.use-case";
import { GetAnalistaDashboardStatsV2UseCase } from "./application/use-cases/GetAnalistaDashboardStatsV2.use-case";
import { ListSolicitudHistoryUseCase } from "./application/use-cases/ListSolicitudHistory.use-case";
import { ListSolicitudTransitionsUseCase } from "./application/use-cases/ListSolicitudTransitions.use-case";
import { ListAssignableSolicitudAgentsUseCase } from "./application/use-cases/ListAssignableSolicitudAgents.use-case";
import { ListFieldAccessRulesUseCase } from "./application/use-cases/ListFieldAccessRules.use-case";
import { ListWorkflowTransitionsUseCase } from "./application/use-cases/ListWorkflowTransitions.use-case";
import { ListSolicitudesUseCase } from "./application/use-cases/ListSolicitudes.use-case";
import { SimularPrestamoUseCase } from "./application/use-cases/SimularPrestamo.use-case";
import { UpdateSolicitudUseCase } from "./application/use-cases/UpdateSolicitud.use-case";
import { UpdateFieldAccessRuleUseCase } from "./application/use-cases/UpdateFieldAccessRule.use-case";
import { UpdateWorkflowTransitionMetadataUseCase } from "./application/use-cases/UpdateWorkflowTransitionMetadata.use-case";
import { SolicitudFieldAccessAdminPrismaDatasource } from "./infrastructure/datasources/SolicitudFieldAccessAdminPrismaDatasource";
import { SolicitudesCorePrismaDatasource } from "./infrastructure/datasources/SolicitudesCorePrismaDatasource";
import { SolicitudWorkflowPrismaDatasource } from "./infrastructure/datasources/SolicitudWorkflowPrismaDatasource";
import { SolicitudFieldAccessRulesPrismaDatasource } from "./infrastructure/datasources/SolicitudFieldAccessRulesPrismaDatasource";
import { WorkflowTransitionAdminPrismaDatasource } from "./infrastructure/datasources/WorkflowTransitionAdminPrismaDatasource";
import { WorkflowStatePrismaDatasource } from "./infrastructure/datasources/WorkflowStatePrismaDatasource";
import { SolicitudFieldAccessAdminRepositoryImpl } from "./infrastructure/repositories/SolicitudFieldAccessAdminRepositoryImpl";
import { SolicitudFieldAccessRulesRepositoryImpl } from "./infrastructure/repositories/SolicitudFieldAccessRulesRepositoryImpl";
import { SolicitudesCoreRepositoryImpl } from "./infrastructure/repositories/SolicitudesCoreRepositoryImpl";
import { SolicitudWorkflowRepositoryImpl } from "./infrastructure/repositories/SolicitudWorkflowRepositoryImpl";
import { WorkflowTransitionAdminRepositoryImpl } from "./infrastructure/repositories/WorkflowTransitionAdminRepositoryImpl";
import { LegacyLineasPrestamoCatalog } from "./infrastructure/services/LegacyLineasPrestamoCatalog";
import { SimularCuotaSolicitud } from "./application/services/SimularCuotaSolicitud";
import { CrearPrestamoGateway } from "./infrastructure/services/CrearPrestamoGateway";
import { EvaluateListLineaPrestamoLegacyIdResolver } from "./infrastructure/services/EvaluateListLineaPrestamoLegacyIdResolver";
import { PrismaWorkflowStateCatalog } from "./infrastructure/services/PrismaWorkflowStateCatalog";
import { SolicitudWorkflowEngine } from "./domain/workflow/SolicitudWorkflowEngine";
import { SolicitudTransitionPolicy } from "./domain/workflow/SolicitudTransitionPolicy";
import { SolicitudWorkflowPlanBuilder } from "./domain/workflow/SolicitudWorkflowPlanBuilder";
import { SolicitudWorkflowPlanExecutor } from "./domain/workflow/SolicitudWorkflowPlanExecutor";
import { FieldAccessAdminController } from "./presentation/FieldAccessAdminController";
import { FieldAccessAdminRoutes } from "./presentation/FieldAccessAdminRoutes";
import { WorkflowTransitionAdminController } from "./presentation/WorkflowTransitionAdminController";
import { WorkflowTransitionAdminRoutes } from "./presentation/WorkflowTransitionAdminRoutes";
import { SolicitudesCoreController } from "./presentation/SolicitudesCoreController";
import { SolicitudesCoreRoutes } from "./presentation/SolicitudesCoreRoutes";
import { FinSolicitudController } from "./presentation/FinSolicitudController";
import { FinSolicitudRoutes } from "./presentation/FinSolicitudRoutes";
import { Router } from "express";

type CreateSolicitudesCoreRouterDependencies = {
  getCurrentUserUseCase: GetCurrentUserUseCase;
};

export function createSolicitudesCoreRouter(
  dependencies: CreateSolicitudesCoreRouterDependencies,
) {
  const solicitudesLegacyGateway = new EvaluateListSolicitudesGateway({
    baseUrl: env.LEGACY_API_BASE_URL,
    timeoutMs: env.LEGACY_API_TIMEOUT_MS,
  });
  const solicitudesCoreDatasource = new SolicitudesCorePrismaDatasource(prisma);
  const solicitudWorkflowDatasource = new SolicitudWorkflowPrismaDatasource(
    prisma,
  );
  const solicitudAdjuntosDatasource = new SolicitudAdjuntosPrismaDatasource(
    prisma,
  );
  const solicitudCancelacionesDatasource =
    new SolicitudCancelacionesPrismaDatasource(prisma);
  const solicitudFieldAccessRulesDatasource =
    new SolicitudFieldAccessRulesPrismaDatasource(prisma);
  const workflowStateDatasource = new WorkflowStatePrismaDatasource(prisma);
  const sociosDatasource = new SociosPrismaDatasource(prisma);
  const solicitudesCoreRepository = new SolicitudesCoreRepositoryImpl(
    solicitudesCoreDatasource,
  );
  const sociosRepository = new SocioRepositoryImpl(sociosDatasource);
  const solicitudWorkflowRepository = new SolicitudWorkflowRepositoryImpl(
    solicitudWorkflowDatasource,
  );
  const solicitudFieldAccessRulesRepository =
    new SolicitudFieldAccessRulesRepositoryImpl(
      solicitudFieldAccessRulesDatasource,
    );
  const solicitudAdjuntoRepository = new SolicitudAdjuntoRepositoryImpl(
    solicitudAdjuntosDatasource,
  );
  const solicitudCancelacionRepository = new SolicitudCancelacionRepositoryImpl(
    solicitudCancelacionesDatasource,
  );
  const adjuntosObjectStorage = new MinioAdjuntosObjectStorage({
    accessKey: env.MINIO_ACCESS_KEY,
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    secretKey: env.MINIO_SECRET_KEY,
    useSSL: env.MINIO_USE_SSL,
  });
  const lineasPrestamoCatalog = new LegacyLineasPrestamoCatalog(
    solicitudesLegacyGateway,
  );
  const prestamosSimulacionGateway = new PrestamosSimulacionGateway({
    baseUrl: env.LEGACY_API_BASE_URL,
    timeoutMs: env.LEGACY_API_TIMEOUT_MS,
  });
  const crearPrestamoGateway = new CrearPrestamoGateway({
    baseUrl: env.LEGACY_API_BASE_URL,
    timeoutMs: env.LEGACY_API_TIMEOUT_MS,
  });
  const lineaPrestamoLegacyIdResolver =
    new EvaluateListLineaPrestamoLegacyIdResolver({
      baseUrl: env.LEGACY_API_BASE_URL,
      timeoutMs: env.LEGACY_API_TIMEOUT_MS,
    });
  const authRepository = new AuthRepositoryImpl(
    new AuthPrismaDatasource(prisma),
  );
  const workflowStateCatalog = new PrismaWorkflowStateCatalog(
    workflowStateDatasource,
  );
  const workflowTransitionPolicy = new SolicitudTransitionPolicy();
  const workflowPlanBuilder = new SolicitudWorkflowPlanBuilder();
  const workflowPlanExecutor = new SolicitudWorkflowPlanExecutor({
    repository: solicitudWorkflowRepository,
  });
  const workflowCapabilitiesService = new SolicitudWorkflowCapabilitiesService();
  const workflowEngine = new SolicitudWorkflowEngine({
    capabilitiesService: workflowCapabilitiesService,
    planBuilder: workflowPlanBuilder,
    planExecutor: workflowPlanExecutor,
    repository: solicitudWorkflowRepository,
    transitionPolicy: workflowTransitionPolicy,
  });
  const simularCuotaSolicitud = new SimularCuotaSolicitud({
    gateway: prestamosSimulacionGateway,
  });
  const createSolicitudUseCase = new CreateSolicitudUseCase({
    lineasPrestamoCatalog,
    repository: solicitudesCoreRepository,
    simularCuotaSolicitud,
    workflowStateCatalog,
  });
  const getSolicitudByIdUseCase = new GetSolicitudByIdUseCase({
    fieldAccessRulesRepository: solicitudFieldAccessRulesRepository,
    repository: solicitudesCoreRepository,
  });
  const assignSolicitudToSelfUseCase = new AssignSolicitudToSelfUseCase({
    repository: solicitudesCoreRepository,
  });
  const assignSolicitudToUserUseCase = new AssignSolicitudToUserUseCase({
    repository: solicitudesCoreRepository,
  });
  const listSolicitudesUseCase = new ListSolicitudesUseCase({
    fieldAccessRulesRepository: solicitudFieldAccessRulesRepository,
    repository: solicitudesCoreRepository,
  });
  const updateSolicitudUseCase = new UpdateSolicitudUseCase({
    fieldAccessRulesRepository: solicitudFieldAccessRulesRepository,
    lineasPrestamoCatalog,
    repository: solicitudesCoreRepository,
    simularCuotaSolicitud,
  });
  const changeSolicitudStateUseCase = new ChangeSolicitudStateUseCase({
    adjuntoRepository: solicitudAdjuntoRepository,
    engine: workflowEngine,
    now: () => new Date(),
    sociosRepository,
    solicitudesRepository: solicitudesCoreRepository,
  });
  const createPrestamoLegacyUseCase = new CreatePrestamoLegacyUseCase({
    authRepository,
    gateway: crearPrestamoGateway,
    lineaPrestamoLegacyIdResolver,
    repository: solicitudesCoreRepository,
    sociosRepository,
    solicitudesLegacyGateway,
    today: () => new Date().toISOString().slice(0, 10),
  });
  const listSolicitudTransitionsUseCase = new ListSolicitudTransitionsUseCase({
    repository: solicitudWorkflowRepository,
    sociosRepository,
    solicitudesRepository: solicitudesCoreRepository,
  });
  const listSolicitudHistoryUseCase = new ListSolicitudHistoryUseCase({
    repository: solicitudWorkflowRepository,
  });
  const listAssignableSolicitudAgentsUseCase =
    new ListAssignableSolicitudAgentsUseCase({
      repository: solicitudesCoreRepository,
    });
  const getSolicitudesStatsUseCase = new GetSolicitudesStatsUseCase({
    repository: solicitudesCoreRepository,
  });
  const getVendedorDashboardStatsUseCase = new GetVendedorDashboardStatsUseCase({
    repository: solicitudesCoreRepository,
  });
  const getAnalistaDashboardStatsUseCase = new GetAnalistaDashboardStatsUseCase({
    repository: solicitudesCoreRepository,
  });
  const getAnalistaDashboardStatsV2UseCase = new GetAnalistaDashboardStatsV2UseCase({
    repository: solicitudesCoreRepository,
  });
  const simularPrestamoUseCase = new SimularPrestamoUseCase({
    gateway: prestamosSimulacionGateway,
    lineasPrestamoCatalog,
  });
  const uploadSolicitudAdjuntoUseCase = new UploadSolicitudAdjuntoUseCase({
    allowedExtensions: env.ADJUNTOS_ALLOWED_EXTENSIONS,
    allowedMimeTypes: env.ADJUNTOS_ALLOWED_MIME_TYPES,
    fieldAccessRulesRepository: solicitudFieldAccessRulesRepository,
    maxFileSizeBytes: env.ADJUNTOS_MAX_FILE_SIZE_BYTES,
    objectStorage: adjuntosObjectStorage,
    repository: solicitudAdjuntoRepository,
    solicitudesRepository: solicitudesCoreRepository,
    storageBucket: env.MINIO_BUCKET_SOLICITUDES,
  });
  const uploadSolicitudAdjuntosBatchUseCase = new UploadSolicitudAdjuntosBatchUseCase({
    allowedExtensions: env.ADJUNTOS_ALLOWED_EXTENSIONS,
    allowedMimeTypes: env.ADJUNTOS_ALLOWED_MIME_TYPES,
    fieldAccessRulesRepository: solicitudFieldAccessRulesRepository,
    maxFileSizeBytes: env.ADJUNTOS_MAX_FILE_SIZE_BYTES,
    objectStorage: adjuntosObjectStorage,
    repository: solicitudAdjuntoRepository,
    solicitudesRepository: solicitudesCoreRepository,
    storageBucket: env.MINIO_BUCKET_SOLICITUDES,
  });
  const listSolicitudAdjuntosUseCase = new ListSolicitudAdjuntosUseCase({
    repository: solicitudAdjuntoRepository,
    solicitudesRepository: solicitudesCoreRepository,
  });
  const downloadSolicitudAdjuntoUseCase = new DownloadSolicitudAdjuntoUseCase({
    objectStorage: adjuntosObjectStorage,
    repository: solicitudAdjuntoRepository,
    solicitudesRepository: solicitudesCoreRepository,
  });
  const deleteSolicitudAdjuntoUseCase = new DeleteSolicitudAdjuntoUseCase({
    fieldAccessRulesRepository: solicitudFieldAccessRulesRepository,
    now: () => new Date(),
    repository: solicitudAdjuntoRepository,
    solicitudesRepository: solicitudesCoreRepository,
  });
  const updateSolicitudAdjuntoUseCase = new UpdateSolicitudAdjuntoUseCase({
    fieldAccessRulesRepository: solicitudFieldAccessRulesRepository,
    repository: solicitudAdjuntoRepository,
    solicitudesRepository: solicitudesCoreRepository,
  });
  const listSolicitudCancelacionesUseCase =
    new ListSolicitudCancelacionesUseCase({
      repository: solicitudCancelacionRepository,
      solicitudesRepository: solicitudesCoreRepository,
    });
  const createSolicitudCancelacionUseCase =
    new CreateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: solicitudFieldAccessRulesRepository,
      repository: solicitudCancelacionRepository,
      solicitudesRepository: solicitudesCoreRepository,
    });
  const updateSolicitudCancelacionUseCase =
    new UpdateSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: solicitudFieldAccessRulesRepository,
      repository: solicitudCancelacionRepository,
      solicitudesRepository: solicitudesCoreRepository,
    });
  const deleteSolicitudCancelacionUseCase =
    new DeleteSolicitudCancelacionUseCase({
      fieldAccessRulesRepository: solicitudFieldAccessRulesRepository,
      now: () => new Date(),
      repository: solicitudCancelacionRepository,
      solicitudesRepository: solicitudesCoreRepository,
    });
  const solicitudesCoreController = new SolicitudesCoreController({
    assignSolicitudToSelfUseCase,
    assignSolicitudToUserUseCase,
    changeSolicitudStateUseCase,
    createPrestamoLegacyUseCase,
    createSolicitudUseCase,
    getCurrentUserUseCase: dependencies.getCurrentUserUseCase,
    getSolicitudByIdUseCase,
    getSolicitudesStatsUseCase,
    getVendedorDashboardStatsUseCase,
    getAnalistaDashboardStatsUseCase,
    getAnalistaDashboardStatsV2UseCase,
    listAssignableSolicitudAgentsUseCase,
    listSolicitudHistoryUseCase,
    listSolicitudTransitionsUseCase,
    listSolicitudesUseCase,
    simularPrestamoUseCase,
    updateSolicitudUseCase,
  });
  const solicitudAdjuntosController = new SolicitudAdjuntosController({
    deleteSolicitudAdjuntoUseCase,
    downloadSolicitudAdjuntoUseCase,
    getCurrentUserUseCase: dependencies.getCurrentUserUseCase,
    listSolicitudAdjuntosUseCase,
    updateSolicitudAdjuntoUseCase,
    uploadSolicitudAdjuntoUseCase,
    uploadSolicitudAdjuntosBatchUseCase,
  });
  const solicitudCancelacionesController = new SolicitudCancelacionesController({
    createSolicitudCancelacionUseCase,
    deleteSolicitudCancelacionUseCase,
    getCurrentUserUseCase: dependencies.getCurrentUserUseCase,
    listSolicitudCancelacionesUseCase,
    updateSolicitudCancelacionUseCase,
  });

  return SolicitudesCoreRoutes.create(
    solicitudesCoreController,
    solicitudAdjuntosController,
    solicitudCancelacionesController,
  );
}

export function createSolicitudesCoreAdminRouter(
  dependencies: CreateSolicitudesCoreRouterDependencies,
) {
  const solicitudFieldAccessAdminDatasource =
    new SolicitudFieldAccessAdminPrismaDatasource(prisma);
  const workflowTransitionAdminDatasource =
    new WorkflowTransitionAdminPrismaDatasource(prisma);
  const solicitudFieldAccessAdminRepository =
    new SolicitudFieldAccessAdminRepositoryImpl(
      solicitudFieldAccessAdminDatasource,
    );
  const workflowTransitionAdminRepository =
    new WorkflowTransitionAdminRepositoryImpl(workflowTransitionAdminDatasource);

  const fieldAccessAdminController = new FieldAccessAdminController({
    getCurrentUserUseCase: dependencies.getCurrentUserUseCase,
    getFieldAccessFieldCatalogUseCase: new GetFieldAccessFieldCatalogUseCase({
      repository: solicitudFieldAccessAdminRepository,
    }),
    getFieldAccessRuleByStateUseCase: new GetFieldAccessRuleByStateUseCase({
      repository: solicitudFieldAccessAdminRepository,
    }),
    listFieldAccessRulesUseCase: new ListFieldAccessRulesUseCase({
      repository: solicitudFieldAccessAdminRepository,
    }),
    updateFieldAccessRuleUseCase: new UpdateFieldAccessRuleUseCase({
      repository: solicitudFieldAccessAdminRepository,
    }),
  });

  const workflowTransitionAdminController =
    new WorkflowTransitionAdminController({
      getCurrentUserUseCase: dependencies.getCurrentUserUseCase,
      getWorkflowTransitionsByStateUseCase:
        new GetWorkflowTransitionsByStateUseCase({
          repository: workflowTransitionAdminRepository,
        }),
      listWorkflowTransitionsUseCase: new ListWorkflowTransitionsUseCase({
        repository: workflowTransitionAdminRepository,
      }),
      updateWorkflowTransitionMetadataUseCase:
        new UpdateWorkflowTransitionMetadataUseCase({
          repository: workflowTransitionAdminRepository,
        }),
    });

  const router = Router();
  router.use(FieldAccessAdminRoutes.create(fieldAccessAdminController));
  router.use(
    WorkflowTransitionAdminRoutes.create(workflowTransitionAdminController),
  );

  return router;
}

// Router publico, sin autenticacion -- ver FinSolicitudRoutes.ts. Se wirea
// aparte del resto (que siempre requiere cookie de sesion) a proposito.
export function createFinSolicitudRouter() {
  const solicitudesLegacyGateway = new EvaluateListSolicitudesGateway({
    baseUrl: env.LEGACY_API_BASE_URL,
    timeoutMs: env.LEGACY_API_TIMEOUT_MS,
  });
  const solicitudesCoreDatasource = new SolicitudesCorePrismaDatasource(prisma);
  const solicitudesCoreRepository = new SolicitudesCoreRepositoryImpl(
    solicitudesCoreDatasource,
  );
  const getFinSolicitudDatosUseCase = new GetFinSolicitudDatosUseCase({
    legacyGateway: solicitudesLegacyGateway,
    repository: solicitudesCoreRepository,
  });
  const finSolicitudController = new FinSolicitudController({
    getFinSolicitudDatosUseCase,
  });

  return FinSolicitudRoutes.create(finSolicitudController);
}
