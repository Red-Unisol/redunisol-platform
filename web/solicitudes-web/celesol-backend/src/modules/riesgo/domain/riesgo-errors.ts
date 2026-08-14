export class RiesgoError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = "RiesgoError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ForbiddenCalculadoraAccessError extends RiesgoError {
  constructor() {
    super(
      "Solo analistas de riesgo y administradores pueden acceder a la calculadora.",
      "CALCULADORA_ACCESS_FORBIDDEN",
      403,
    );
    this.name = "ForbiddenCalculadoraAccessError";
  }
}

export class CalculadoraFileNotFoundError extends RiesgoError {
  constructor() {
    super(
      "No se encontró el archivo de la calculadora de riesgo.",
      "CALCULADORA_FILE_NOT_FOUND",
      404,
    );
    this.name = "CalculadoraFileNotFoundError";
  }
}

export class InvalidSolicitudOidError extends RiesgoError {
  constructor() {
    super(
      "El identificador de la solicitud no es válido.",
      "CALCULADORA_INVALID_SOLICITUD_OID",
      400,
    );
    this.name = "InvalidSolicitudOidError";
  }
}

export class CalculadoraMutualLegacyUnavailableError extends RiesgoError {
  constructor() {
    super(
      "No se pudo conectar con el sistema legado para obtener los datos de la solicitud.",
      "CALCULADORA_LEGACY_UNAVAILABLE",
      502,
    );
    this.name = "CalculadoraMutualLegacyUnavailableError";
  }
}

export class SolicitudNotFoundError extends RiesgoError {
  constructor() {
    super(
      "No existe una solicitud con ese identificador.",
      "CALCULADORA_SOLICITUD_NOT_FOUND",
      404,
    );
    this.name = "SolicitudNotFoundError";
  }
}
