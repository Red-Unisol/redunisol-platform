import {
  ForbiddenSolicitudAccessError,
  MissingWorkflowOwnerAssignmentError,
  SolicitudWorkflowCommentRequiredError,
  SolicitudWorkflowDestinationInactiveError,
  SolicitudWorkflowTransitionNotAllowedError,
} from "../solicitudes-core-errors";
import type { WorkflowValidationContext } from "./types";

// La transicion "pagar" (Transferir -> Pagada) es una excepcion puntual: la
// puede ejecutar tanto el owner actual (TESORERIA) como cualquier usuario
// del owner RIESGO, ademas de isSystemAdmin. Ningun otro actionCode tiene
// este comportamiento.
const RIESGO_OWNER_ACTION_EXCEPTIONS = new Set(["pagar"]);

export class SolicitudTransitionPolicy {
  validate(context: WorkflowValidationContext) {
    const solicitud = context.transitionValidation.solicitud;

    if (!solicitud) {
      return;
    }

    if (!context.command.isSystemAdmin) {
      if (!context.command.workflowOwnerId) {
        throw new MissingWorkflowOwnerAssignmentError();
      }

      const isOwnerMatch = solicitud.ownerId === context.command.workflowOwnerId;
      const isRiesgoException =
        RIESGO_OWNER_ACTION_EXCEPTIONS.has(context.command.actionCode) &&
        context.command.workflowOwnerCode === "RIESGO";

      if (!isOwnerMatch && !isRiesgoException) {
        throw new ForbiddenSolicitudAccessError();
      }
    }

    const transition = context.transitionValidation.transition;

    if (!transition) {
      throw new SolicitudWorkflowTransitionNotAllowedError();
    }

    if (!transition.isActive) {
      throw new SolicitudWorkflowTransitionNotAllowedError();
    }

    if (!transition.toStateIsActive) {
      throw new SolicitudWorkflowDestinationInactiveError();
    }

    const comentario = context.command.comment?.trim() || null;

    if (transition.requiresComment && !comentario) {
      throw new SolicitudWorkflowCommentRequiredError();
    }
  }
}
