import type {
  AssignableSolicitudAgent,
  ListAssignableSolicitudAgentsInput,
} from "../dtos/ListAssignableSolicitudAgents.dto";
import {
  ForbiddenSolicitudAccessError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudAssignmentNotAllowedError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  repository: SolicitudesCoreRepository;
};

export class ListAssignableSolicitudAgentsUseCase {
  private readonly repository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(
    input: ListAssignableSolicitudAgentsInput,
  ): Promise<AssignableSolicitudAgent[]> {
    if (!this.repository.listUsersByWorkflowOwnerId) {
      throw new Error("Assignment repository methods are not available.");
    }

    if (!input.currentUser.isSystemAdmin && !input.currentUser.workflowOwnerId) {
      throw new MissingWorkflowOwnerAssignmentError();
    }

    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    const ownerId = solicitud.estadoActual.ownerId ?? null;

    if (!input.currentUser.isSystemAdmin) {
      if (!ownerId || ownerId !== input.currentUser.workflowOwnerId) {
        throw new ForbiddenSolicitudAccessError();
      }

      if (
        solicitud.estadoActual.code === "Motor" ||
        solicitud.estadoActual.owner?.code === "SISTEMA" ||
        solicitud.estadoActual.owner?.code !== "RIESGO"
      ) {
        throw new SolicitudAssignmentNotAllowedError();
      }
    }

    if (input.currentUser.isSystemAdmin) {
      return this.repository.listUsersByWorkflowOwnerId();
    }

    if (!ownerId) {
      return [];
    }

    return this.repository.listUsersByWorkflowOwnerId(ownerId);
  }
}
