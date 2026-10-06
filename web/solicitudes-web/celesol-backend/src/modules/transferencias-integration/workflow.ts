import type { Prisma, PrismaClient } from "@prisma/client";
import { ChangeSolicitudStateUseCase } from "../solicitudes-core/application/use-cases/ChangeSolicitudState.use-case";
import { SolicitudWorkflowEngine } from "../solicitudes-core/domain/workflow/SolicitudWorkflowEngine";
import { SolicitudWorkflowPrismaDatasource } from "../solicitudes-core/infrastructure/datasources/SolicitudWorkflowPrismaDatasource";
import { SolicitudWorkflowRepositoryImpl } from "../solicitudes-core/infrastructure/repositories/SolicitudWorkflowRepositoryImpl";
import { SolicitudesCorePrismaDatasource } from "../solicitudes-core/infrastructure/datasources/SolicitudesCorePrismaDatasource";
import { SolicitudesCoreRepositoryImpl } from "../solicitudes-core/infrastructure/repositories/SolicitudesCoreRepositoryImpl";
import { SolicitudAdjuntosPrismaDatasource } from "../solicitudes-core/adjuntos/infrastructure/datasources/SolicitudAdjuntosPrismaDatasource";
import { SolicitudAdjuntoRepositoryImpl } from "../solicitudes-core/adjuntos/infrastructure/repositories/SolicitudAdjuntoRepositoryImpl";
import { SociosPrismaDatasource } from "../socios/infrastructure/datasources/SociosPrismaDatasource";
import { SocioRepositoryImpl } from "../socios/infrastructure/repositories/SocioRepositoryImpl";
import type { Actor } from "./domain";

export function createPayWorkflow(db: PrismaClient) {
  // These repositories only supply non-mutating guards/owner lookup for "pagar".
  const solicitudesRepository = new SolicitudesCoreRepositoryImpl(
    new SolicitudesCorePrismaDatasource(db),
  );
  const adjuntoRepository = new SolicitudAdjuntoRepositoryImpl(
    new SolicitudAdjuntosPrismaDatasource(db),
  );
  const sociosRepository = new SocioRepositoryImpl(
    new SociosPrismaDatasource(db),
  );
  return async (
    tx: Prisma.TransactionClient,
    solicitudId: string,
    actor: Actor,
    comment: string,
  ) => {
    const repository = new SolicitudWorkflowRepositoryImpl(
      new SolicitudWorkflowPrismaDatasource(db, tx),
    );
    const useCase = new ChangeSolicitudStateUseCase({
      adjuntoRepository,
      sociosRepository,
      solicitudesRepository,
      now: () => new Date(),
      engine: new SolicitudWorkflowEngine({ repository }),
    });
    await useCase.execute({
      solicitudId,
      actionCode: "pagar",
      comment,
      currentUser: { id: actor.id, workflowOwnerId: actor.workflowOwnerId },
    });
  };
}
