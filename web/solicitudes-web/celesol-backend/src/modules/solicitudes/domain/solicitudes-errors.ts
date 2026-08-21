export class SolicitudesError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "SolicitudesError";
    this.statusCode = statusCode;
  }
}

export class InvalidSolicitudesRequestError extends SolicitudesError {
  constructor(message = "Request invalido.") {
    super(message, 400);
    this.name = "InvalidSolicitudesRequestError";
  }
}

export class LegacySolicitudesUnavailableError extends SolicitudesError {
  constructor() {
    super("Legacy service unavailable.", 503);
    this.name = "LegacySolicitudesUnavailableError";
  }
}

export class SolicitudNotFoundError extends SolicitudesError {
  constructor() {
    super("Solicitud not found.", 404);
    this.name = "SolicitudNotFoundError";
  }
}

export class SocioMutualCancelacionNotFoundError extends SolicitudesError {
  constructor() {
    super("Socio not found.", 404);
    this.name = "SocioMutualCancelacionNotFoundError";
  }
}

export class MissingWorkflowOwnerAssignmentError extends SolicitudesError {
  constructor() {
    super("User has no workflow owner assignment.", 403);
    this.name = "MissingWorkflowOwnerAssignmentError";
  }
}

export class PrestamoSimulacionRechazadaError extends SolicitudesError {
  constructor(message: string) {
    super(message, 422);
    this.name = "PrestamoSimulacionRechazadaError";
  }
}
