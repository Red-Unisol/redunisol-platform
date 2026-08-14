import { SolicitudesError } from "../../../solicitudes/domain/solicitudes-errors";

export class InvalidSolicitudAdjuntoRequestError extends SolicitudesError {
  constructor(message = "Request invalido.") {
    super(message, 400);
    this.name = "InvalidSolicitudAdjuntoRequestError";
  }
}

export class SolicitudAdjuntoNotFoundError extends SolicitudesError {
  constructor() {
    super("Solicitud adjunto not found.", 404);
    this.name = "SolicitudAdjuntoNotFoundError";
  }
}

export class ForbiddenSolicitudAdjuntoAccessError extends SolicitudesError {
  constructor() {
    super("Forbidden solicitud adjunto access.", 403);
    this.name = "ForbiddenSolicitudAdjuntoAccessError";
  }
}

export class MissingWorkflowOwnerAssignmentError extends SolicitudesError {
  constructor() {
    super("User has no workflow owner assignment.", 403);
    this.name = "MissingWorkflowOwnerAssignmentError";
  }
}

export class SolicitudAdjuntoUploadNotAllowedError extends SolicitudesError {
  constructor(message = "Solicitud adjunto upload not allowed.") {
    super(message, 415);
    this.name = "SolicitudAdjuntoUploadNotAllowedError";
  }
}

export class SolicitudAdjuntoNotEditableError extends SolicitudesError {
  constructor() {
    super("Solicitud adjunto is not editable in the current state.", 409);
    this.name = "SolicitudAdjuntoNotEditableError";
  }
}

export class SolicitudAdjuntoStorageUnavailableError extends SolicitudesError {
  constructor() {
    super("Solicitud adjunto storage unavailable.", 503);
    this.name = "SolicitudAdjuntoStorageUnavailableError";
  }
}

export class SolicitudAdjuntoStorageReferenceMissingError extends SolicitudesError {
  constructor() {
    super("Solicitud adjunto storage reference missing.", 409);
    this.name = "SolicitudAdjuntoStorageReferenceMissingError";
  }
}
