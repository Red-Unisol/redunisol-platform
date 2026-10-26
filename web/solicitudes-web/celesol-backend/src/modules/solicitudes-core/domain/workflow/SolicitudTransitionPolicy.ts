import { ADMIN_CORRECTION_ACTION, AdministrativeCorrectionError } from "./AdministrativeCorrection";
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
    if (context.command.actionCode === ADMIN_CORRECTION_ACTION) {
      if (!context.command.isSystemAdmin || !context.command.administrativeCorrection)
        throw new ForbiddenSolicitudAccessError();
      if (!context.command.comment?.trim())
        throw new AdministrativeCorrectionError("Indicá el motivo de la corrección administrativa.", 400);
    }
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
      const isLegajosException = context.command.actionCode === "transferir" &&
        context.command.workflowOwnerCode === "LEGAJOS_DIGITALES" &&
        ["Liquidada", "VerificarFirmaYDocumentacion"].includes(solicitud.stateCode ?? "");

      if (!isOwnerMatch && !isRiesgoException && !isLegajosException) {
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
