import { SolicitudesError } from "../../solicitudes/domain/solicitudes-errors";

export class InvalidSolicitudesCoreRequestError extends SolicitudesError {
  constructor(message = "Request invalido.") {
    super(message, 400);
    this.name = "InvalidSolicitudesCoreRequestError";
  }
}

export class LegacyLineaPrestamoUnavailableError extends SolicitudesError {
  constructor() {
    super("Legacy loan line unavailable.", 503);
    this.name = "LegacyLineaPrestamoUnavailableError";
  }
}

export class WorkflowInitialStateNotConfiguredError extends SolicitudesError {
  constructor() {
    super("Workflow initial state not configured.", 500);
    this.name = "WorkflowInitialStateNotConfiguredError";
  }
}

export class MissingAuthenticatedLegacyUserError extends SolicitudesError {
  constructor() {
    super("Authenticated legacy user is required.", 500);
    this.name = "MissingAuthenticatedLegacyUserError";
  }
}

export class MissingAuthenticatedSellerNameError extends SolicitudesError {
  constructor() {
    super("Authenticated seller name is required.", 500);
    this.name = "MissingAuthenticatedSellerNameError";
  }
}

export class SolicitudCoreNotFoundError extends SolicitudesError {
  constructor() {
    super("Solicitud not found.", 404);
    this.name = "SolicitudCoreNotFoundError";
  }
}

export class SolicitudPrestamoNoGeneradoError extends SolicitudesError {
  constructor() {
    super("El préstamo de esta solicitud todavía no fue generado.", 400);
    this.name = "SolicitudPrestamoNoGeneradoError";
  }
}

export class ForbiddenSolicitudAccessError extends SolicitudesError {
  constructor() {
    super("Forbidden solicitud access.", 403);
    this.name = "ForbiddenSolicitudAccessError";
  }
}

export class MissingWorkflowOwnerAssignmentError extends SolicitudesError {
  constructor() {
    super("User has no workflow owner assignment.", 403);
    this.name = "MissingWorkflowOwnerAssignmentError";
  }
}

export class SolicitudCoreNotEditableError extends SolicitudesError {
  constructor() {
    super("Solicitud is not editable in the current state.", 409);
    this.name = "SolicitudCoreNotEditableError";
  }
}

export class SolicitudFieldNotEditableInCurrentStateError extends SolicitudesError {
  readonly fieldKey?: string;

  constructor(fieldKey?: string) {
    super("FIELD_NOT_EDITABLE_IN_CURRENT_STATE", 409);
    this.fieldKey = fieldKey;
    this.name = "SolicitudFieldNotEditableInCurrentStateError";
  }
}

export class SolicitudWorkflowTransitionNotAllowedError extends SolicitudesError {
  constructor() {
    super("Solicitud workflow transition not allowed.", 409);
    this.name = "SolicitudWorkflowTransitionNotAllowedError";
  }
}

export class SolicitudTitularSocioRequiredForWorkflowError extends SolicitudesError {
  constructor() {
    super("Debe existir un socio creado para iniciar el flujo de la solicitud.", 409);
    this.name = "SolicitudTitularSocioRequiredForWorkflowError";
  }
}

export class SolicitudReciboSueldoAdjuntoRequiredForWorkflowError extends SolicitudesError {
  constructor() {
    super(
      "Debe adjuntar un recibo de sueldo antes de enviar la solicitud a Riesgo.",
      409,
    );
    this.name = "SolicitudReciboSueldoAdjuntoRequiredForWorkflowError";
  }
}

export class SolicitudTitularDataIncompleteForConfirmarError extends SolicitudesError {
  readonly missingLabels: string[];

  constructor(missingLabels: string[]) {
    super(
      `Debe completar los siguientes datos del titular antes de confirmar: ${missingLabels.join(", ")}.`,
      409,
    );
    this.name = "SolicitudTitularDataIncompleteForConfirmarError";
    this.missingLabels = missingLabels;
  }
}

export class SolicitudWorkflowCommentRequiredError extends SolicitudesError {
  constructor() {
    super("Solicitud workflow transition comment is required.", 400);
    this.name = "SolicitudWorkflowCommentRequiredError";
  }
}

export class SolicitudWorkflowDestinationInactiveError extends SolicitudesError {
  constructor() {
    super("Solicitud workflow destination state is inactive.", 409);
    this.name = "SolicitudWorkflowDestinationInactiveError";
  }
}

export class WorkflowExecutionPlanNotExecutableError extends SolicitudesError {
  constructor(issues: string[]) {
    super(
      `Workflow execution plan is not executable: ${issues.join(", ")}.`,
      500,
    );
    this.name = "WorkflowExecutionPlanNotExecutableError";
  }
}

export class WorkflowExecutionPlanStateConflictError extends SolicitudesError {
  constructor() {
    super("Workflow execution plan state conflict.", 409);
    this.name = "WorkflowExecutionPlanStateConflictError";
  }
}

export class SolicitudAlreadyAssignedError extends SolicitudesError {
  constructor() {
    super("Solicitud is already assigned.", 409);
    this.name = "SolicitudAlreadyAssignedError";
  }
}

export class PrestamoLegacyRechazadoError extends SolicitudesError {
  constructor(message: string) {
    super(message, 422);
    this.name = "PrestamoLegacyRechazadoError";
  }
}

export class PrestamoLegacyUnavailableError extends SolicitudesError {
  constructor() {
    super("No se pudo conectar con el sistema legado.", 503);
    this.name = "PrestamoLegacyUnavailableError";
  }
}

export class SolicitudLegacyOidAlreadyExistsError extends SolicitudesError {
  constructor() {
    super(
      "Ya existe un préstamo creado en el legado para esta solicitud.",
      409,
    );
    this.name = "SolicitudLegacyOidAlreadyExistsError";
  }
}

export class SolicitudPrestamoDataIncompleteError extends SolicitudesError {
  readonly missingFieldLabels: string[];

  constructor(missingFieldLabels: string[]) {
    super(
      `Debe completar los siguientes datos antes de crear el préstamo en el legado: ${missingFieldLabels.join(", ")}.`,
      409,
    );
    this.name = "SolicitudPrestamoDataIncompleteError";
    this.missingFieldLabels = missingFieldLabels;
  }
}

export class SolicitudLineaPrestamoLegacyIdUnresolvedError extends SolicitudesError {
  readonly lineaDescripcion: string;

  constructor(lineaDescripcion: string) {
    super(
      `No se pudo determinar la línea "${lineaDescripcion}" en el sistema legado. No se creó el préstamo: crearlo sin resolverla lo daría de alta con otra línea y otra tasa.`,
      409,
    );
    this.name = "SolicitudLineaPrestamoLegacyIdUnresolvedError";
    this.lineaDescripcion = lineaDescripcion;
  }
}

export class SolicitudTitularSocioLegacyRequiredError extends SolicitudesError {
  constructor() {
    super(
      "El socio del titular todavía no fue dado de alta en el legado.",
      409,
    );
    this.name = "SolicitudTitularSocioLegacyRequiredError";
  }
}

export class SolicitudVendedorLegacyRequiredError extends SolicitudesError {
  constructor() {
    super(
      "No se pudo determinar el vendedor en el legado para esta solicitud.",
      409,
    );
    this.name = "SolicitudVendedorLegacyRequiredError";
  }
}

export class SolicitudPrestamoLegacyRequiredForWorkflowError extends SolicitudesError {
  constructor() {
    super(
      "Debe generar el préstamo antes de liquidar la solicitud.",
      409,
    );
    this.name = "SolicitudPrestamoLegacyRequiredForWorkflowError";
  }
}

export class SolicitudAssignmentNotAllowedError extends SolicitudesError {
  constructor() {
    super("Solicitud assignment is not allowed in the current state.", 409);
    this.name = "SolicitudAssignmentNotAllowedError";
  }
}

export class TargetUserNotFoundError extends SolicitudesError {
  constructor() {
    super("Target user not found.", 404);
    this.name = "TargetUserNotFoundError";
  }
}

export class FieldAccessRuleInvalidFieldError extends SolicitudesError {
  constructor() {
    super("FIELD_ACCESS_RULE_INVALID_FIELD", 400);
    this.name = "FieldAccessRuleInvalidFieldError";
  }
}

export class FieldAccessRuleInvalidGroupError extends SolicitudesError {
  constructor() {
    super("FIELD_ACCESS_RULE_INVALID_GROUP", 400);
    this.name = "FieldAccessRuleInvalidGroupError";
  }
}

export class FieldAccessRuleBlockedFieldError extends SolicitudesError {
  constructor() {
    super("FIELD_ACCESS_RULE_BLOCKED_FIELD", 400);
    this.name = "FieldAccessRuleBlockedFieldError";
  }
}

export class FieldAccessRuleDuplicatedFieldError extends SolicitudesError {
  constructor() {
    super("FIELD_ACCESS_RULE_DUPLICATED_FIELD", 400);
    this.name = "FieldAccessRuleDuplicatedFieldError";
  }
}

export class FieldAccessRuleDuplicatedGroupError extends SolicitudesError {
  constructor() {
    super("FIELD_ACCESS_RULE_DUPLICATED_GROUP", 400);
    this.name = "FieldAccessRuleDuplicatedGroupError";
  }
}

export class FieldAccessRuleInvalidAppearanceColorError extends SolicitudesError {
  constructor() {
    super("FIELD_ACCESS_RULE_INVALID_APPEARANCE_COLOR", 400);
    this.name = "FieldAccessRuleInvalidAppearanceColorError";
  }
}

export class FieldAccessRuleStateNotFoundError extends SolicitudesError {
  constructor() {
    super("FIELD_ACCESS_RULE_STATE_NOT_FOUND", 404);
    this.name = "FieldAccessRuleStateNotFoundError";
  }
}

export class FieldAccessRuleVersionConflictError extends SolicitudesError {
  constructor() {
    super("FIELD_ACCESS_RULE_VERSION_CONFLICT", 409);
    this.name = "FieldAccessRuleVersionConflictError";
  }
}

export class WorkflowTransitionStateNotFoundError extends SolicitudesError {
  constructor() {
    super("WORKFLOW_TRANSITION_STATE_NOT_FOUND", 404);
    this.name = "WorkflowTransitionStateNotFoundError";
  }
}

export class WorkflowTransitionNotFoundError extends SolicitudesError {
  constructor() {
    super("WORKFLOW_TRANSITION_NOT_FOUND", 404);
    this.name = "WorkflowTransitionNotFoundError";
  }
}

export class WorkflowTransitionVersionConflictError extends SolicitudesError {
  constructor() {
    super("WORKFLOW_TRANSITION_VERSION_CONFLICT", 409);
    this.name = "WorkflowTransitionVersionConflictError";
  }
}
