import type { AssignSolicitudToUserInput } from "../dtos/AssignSolicitudToUser.dto";
import {
  ForbiddenSolicitudAccessError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudAlreadyAssignedError,
  SolicitudAssignmentNotAllowedError,
  SolicitudCoreNotFoundError,
  TargetUserNotFoundError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";

type Dependencies = {
  repository: SolicitudesCoreRepository;
};

export class AssignSolicitudToUserUseCase {
  private readonly repository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
  }

  async execute(input: AssignSolicitudToUserInput) {
    if (!this.repository.findUserById || !this.repository.assignToUserIfUnassigned) {
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

    const targetUser = await this.repository.findUserById(input.targetUserId);

    if (!targetUser) {
      throw new TargetUserNotFoundError();
    }

    if (!targetUser.workflowOwnerId) {
      throw new MissingWorkflowOwnerAssignmentError();
    }

    if (input.currentUser.isSystemAdmin) {
      // Admin may assign to any target user, regardless of the solicitud's current owner.
    } else if (input.currentUser.isAnalista) {
      if (targetUser.workflowOwnerId !== input.currentUser.workflowOwnerId) {
        throw new ForbiddenSolicitudAccessError();
      }
    } else if (targetUser.workflowOwnerId !== ownerId) {
      throw new ForbiddenSolicitudAccessError();
    }

    const assigned = await this.repository.assignToUserIfUnassigned({
      actorUserId: input.currentUser.id,
      allowReassignment: canReassignFreely,
      assignedToUserId: input.targetUserId,
      solicitudId: input.solicitudId,
    });

    if (!assigned) {
      throw new SolicitudAlreadyAssignedError();
    }

    return assigned;
  }
}
