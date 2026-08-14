import type { AssignSolicitudToSelfInput } from "../dtos/AssignSolicitudToSelf.dto";
import {
  ForbiddenSolicitudAccessError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudAlreadyAssignedError,
  SolicitudAssignmentNotAllowedError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  repository: SolicitudesCoreRepository;
};

export class AssignSolicitudToSelfUseCase {
  private readonly repository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(input: AssignSolicitudToSelfInput) {
    if (!this.repository.assignToUserIfUnassigned) {
      throw new Error("Assignment repository method is not available.");
    }

    if (!input.currentUser.isSystemAdmin && !input.currentUser.workflowOwnerId) {
      throw new MissingWorkflowOwnerAssignmentError();
    }

    const solicitud = await this.repository.findById(input.solicitudId);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    const ownerId = solicitud.estadoActual.ownerId ?? null;
    const isRiesgoOwnedByCurrentUser =
      solicitud.estadoActual.owner?.code === "RIESGO" &&
      ownerId !== null &&
      ownerId === input.currentUser.workflowOwnerId;
    const canReassignFreely =
      Boolean(input.currentUser.isSystemAdmin) || isRiesgoOwnedByCurrentUser;

    if (solicitud.assignedToUserId && !canReassignFreely) {
      throw new SolicitudAlreadyAssignedError();
    }

    if (!input.currentUser.isSystemAdmin && !input.currentUser.isAnalista) {
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

    const assigned = await this.repository.assignToUserIfUnassigned({
      actorUserId: input.currentUser.id,
      allowReassignment: canReassignFreely,
      assignedToUserId: input.currentUser.id,
      solicitudId: input.solicitudId,
    });

    if (!assigned) {
      throw new SolicitudAlreadyAssignedError();
    }

    return assigned;
  }
}
