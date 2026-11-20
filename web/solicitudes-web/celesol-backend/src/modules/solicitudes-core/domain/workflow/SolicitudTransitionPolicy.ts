import { hasWorkflowArea, hasWorkflowAreaId, userWorkflowAreaIds } from "../../../auth/domain/workflow-areas";
import { ADMIN_CORRECTION_ACTION, AdministrativeCorrectionError } from "./AdministrativeCorrection";
import { REVERSE_DISMISSAL_ACTION } from "./Dismissal";
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
export function canActOnWorkflowState(
  actor: Parameters<typeof hasWorkflowArea>[0],
  ownerId: string | null,
  stateCode: string | undefined,
  actionCode: string,
) {
  if (hasWorkflowAreaId(actor, ownerId)) return true;
  if (actionCode === "pagar" && stateCode === "Transferir") return hasWorkflowArea(actor, "RIESGO");
  return actionCode === "transferir" && ["Liquidada", "VerificarFirmaYDocumentacion"].includes(stateCode ?? "") &&
    hasWorkflowArea(actor, "LEGAJOS_DIGITALES");
}

export class SolicitudTransitionPolicy {
  validate(context: WorkflowValidationContext) {
    if (context.command.actionCode === REVERSE_DISMISSAL_ACTION && !context.command.isSystemAdmin)
      throw new ForbiddenSolicitudAccessError();
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
      if (!userWorkflowAreaIds(context.command).length) {
        throw new MissingWorkflowOwnerAssignmentError();
      }

      if (!canActOnWorkflowState(context.command, solicitud.ownerId, solicitud.stateCode, context.command.actionCode)) {
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
