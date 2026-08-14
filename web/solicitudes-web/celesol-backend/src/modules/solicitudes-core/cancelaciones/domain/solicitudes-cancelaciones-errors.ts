import { SolicitudesError } from "../../../solicitudes/domain/solicitudes-errors";

export class InvalidSolicitudCancelacionRequestError extends SolicitudesError {
  constructor(message = "Request invalido.") {
    super(message, 400);
    this.name = "InvalidSolicitudCancelacionRequestError";
  }
}

export class SolicitudCancelacionNotFoundError extends SolicitudesError {
  constructor() {
    super("Solicitud cancelacion not found.", 404);
    this.name = "SolicitudCancelacionNotFoundError";
  }
}

export class ForbiddenSolicitudCancelacionAccessError extends SolicitudesError {
  constructor() {
    super("Forbidden solicitud cancelacion access.", 403);
    this.name = "ForbiddenSolicitudCancelacionAccessError";
  }
}

export class MissingWorkflowOwnerAssignmentError extends SolicitudesError {
  constructor() {
    super("User has no workflow owner assignment.", 403);
    this.name = "MissingWorkflowOwnerAssignmentError";
  }
}
