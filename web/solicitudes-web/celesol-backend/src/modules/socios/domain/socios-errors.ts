export class SocioError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = "SocioError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class InvalidSocioRequestError extends SocioError {
  constructor(message: string) {
    super(message, "SOCIO_INVALID_REQUEST", 400);
    this.name = "InvalidSocioRequestError";
  }
}

export class SocioNotFoundError extends SocioError {
  constructor() {
    super("Socio not found.", "SOCIO_NOT_FOUND", 404);
    this.name = "SocioNotFoundError";
  }
}

export class SocioCuitDuplicateError extends SocioError {
  constructor() {
    super("Socio cuit already exists.", "SOCIO_CUIT_DUPLICATE", 409);
    this.name = "SocioCuitDuplicateError";
  }
}

export class SocioDocumentoDuplicateError extends SocioError {
  constructor() {
    super(
      "Socio document already exists.",
      "SOCIO_DOCUMENTO_DUPLICATE",
      409,
    );
    this.name = "SocioDocumentoDuplicateError";
  }
}

export class ForbiddenSocioCreationError extends SocioError {
  constructor() {
    super(
      "Solo analistas y administradores pueden crear socios.",
      "SOCIO_CREATION_FORBIDDEN",
      403,
    );
    this.name = "ForbiddenSocioCreationError";
  }
}

export class ForbiddenSocioUpdateError extends SocioError {
  constructor() {
    super(
      "Solo analistas y administradores pueden editar socios.",
      "SOCIO_UPDATE_FORBIDDEN",
      403,
    );
    this.name = "ForbiddenSocioUpdateError";
  }
}

export class ForbiddenSocioDeleteError extends SocioError {
  constructor() {
    super(
      "Solo analistas y administradores pueden eliminar socios.",
      "SOCIO_DELETE_FORBIDDEN",
      403,
    );
    this.name = "ForbiddenSocioDeleteError";
  }
}

export class SocioMutualLegacyRechazadoError extends SocioError {
  constructor(message: string) {
    super(message, "SOCIO_MUTUAL_LEGACY_RECHAZADO", 422);
    this.name = "SocioMutualLegacyRechazadoError";
  }
}

export class SocioMutualLegacyUnavailableError extends SocioError {
  constructor() {
    super(
      "No se pudo conectar con el sistema legado.",
      "SOCIO_MUTUAL_LEGACY_UNAVAILABLE",
      503,
    );
    this.name = "SocioMutualLegacyUnavailableError";
  }
}
