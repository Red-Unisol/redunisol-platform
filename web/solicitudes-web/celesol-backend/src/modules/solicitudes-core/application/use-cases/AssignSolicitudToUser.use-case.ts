import { hasWorkflowAreaId, userWorkflowAreaIds } from "../../../auth/domain/workflow-areas";
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

    if (!input.currentUser.isSystemAdmin && !userWorkflowAreaIds(input.currentUser).length) {
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
      hasWorkflowAreaId(input.currentUser, ownerId);
    const canReassignFreely =
      Boolean(input.currentUser.isSystemAdmin) || isRiesgoOwnedByCurrentUser;

    if (solicitud.assignedToUserId && !canReassignFreely) {
      throw new SolicitudAlreadyAssignedError();
    }

    if (!input.currentUser.isSystemAdmin && !input.currentUser.isAnalista) {
      if (!hasWorkflowAreaId(input.currentUser, ownerId)) {
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

    if (!userWorkflowAreaIds(targetUser).length) {
      throw new MissingWorkflowOwnerAssignmentError();
    }

    if (input.currentUser.isSystemAdmin) {
      // Admin may assign to any target user, regardless of the solicitud's current owner.
    } else if (input.currentUser.isAnalista) {
      const analystArea = input.currentUser.workflowOwners === undefined
        ? input.currentUser.workflowOwnerId
        : input.currentUser.workflowOwners.find(area => area.code === "RIESGO")?.id;
      if (!hasWorkflowAreaId(targetUser, analystArea)) {
        throw new ForbiddenSolicitudAccessError();
      }
    } else if (!hasWorkflowAreaId(targetUser, ownerId)) {
      throw new ForbiddenSolicitudAccessError();
    }

    const assigned = await this.repository.assignToUserIfUnassigned({
      actorUserId: input.currentUser.id,
      allowReassignment: canReassignFreely,
      ...(!input.currentUser.isSystemAdmin && !input.currentUser.isAnalista && ownerId ? { requiredAreaId: ownerId } : {}),
      assignedToUserId: input.targetUserId,
      solicitudId: input.solicitudId,
    });

    if (!assigned) {
      throw new SolicitudAlreadyAssignedError();
    }

    return assigned;
  }
}
