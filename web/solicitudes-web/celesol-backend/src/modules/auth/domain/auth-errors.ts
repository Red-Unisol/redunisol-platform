export class AuthError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor() {
    super("Credenciales invalidas.", 401);
    this.name = "InvalidCredentialsError";
  }
}

export class EmailNotVerifiedError extends AuthError {
  constructor() {
    super("Email not verified.", 403);
    this.name = "EmailNotVerifiedError";
  }
}

export class InvalidSessionError extends AuthError {
  constructor() {
    super("Sesion invalida.", 401);
    this.name = "InvalidSessionError";
  }
}

export class InvalidRequestError extends AuthError {
  constructor(message: string) {
    super(message, 400);
    this.name = "InvalidRequestError";
  }
}

export class AuthConflictError extends AuthError {
  constructor(message: string) {
    super(message, 409);
    this.name = "AuthConflictError";
  }
}

export class LegacyUserNotFoundError extends AuthError {
  constructor() {
    super("Legacy user not found.", 400);
    this.name = "LegacyUserNotFoundError";
  }
}

export class LegacyUserInactiveError extends AuthError {
  constructor() {
    super("Legacy user is inactive.", 400);
    this.name = "LegacyUserInactiveError";
  }
}

export class LegacyServiceUnavailableError extends AuthError {
  constructor() {
    super("Legacy service unavailable.", 503);
    this.name = "LegacyServiceUnavailableError";
  }
}

export class InvalidEmailVerificationCodeError extends AuthError {
  constructor() {
    super("Invalid email verification code.", 400);
    this.name = "InvalidEmailVerificationCodeError";
  }
}

export class InvalidPasswordResetTokenError extends AuthError {
  constructor() {
    super("Invalid password reset token.", 400);
    this.name = "InvalidPasswordResetTokenError";
  }
}

export class EmailDeliveryError extends AuthError {
  constructor() {
    super("Email delivery failed.", 503);
    this.name = "EmailDeliveryError";
  }
}

export class TooManyEmailRequestsError extends AuthError {
  constructor() {
    super(
      "Demasiados envios de correo. Intente nuevamente en unos minutos.",
      429,
    );
    this.name = "TooManyEmailRequestsError";
  }
}

export class WorkflowOwnerNotFoundOrInactiveError extends AuthError {
  constructor() {
    super("Workflow owner not found or inactive.", 400);
    this.name = "WorkflowOwnerNotFoundOrInactiveError";
  }
}

export class UserNotFoundError extends AuthError {
  constructor() {
    super("User not found.", 404);
    this.name = "UserNotFoundError";
  }
}

export class InvalidCurrentPasswordError extends AuthError {
  constructor() {
    super("Contraseña actual incorrecta.", 401);
    this.name = "InvalidCurrentPasswordError";
  }
}

export class ForbiddenSystemAdminOnlyError extends AuthError {
  constructor() {
    super("System admin required.", 403);
    this.name = "ForbiddenSystemAdminOnlyError";
  }
}

export class LastActiveSystemAdminDemotionError extends AuthError {
  constructor() {
    super("Cannot remove the last active system admin.", 409);
    this.name = "LastActiveSystemAdminDemotionError";
  }
}

export class LastActiveSystemAdminDeactivationError extends AuthError {
  constructor() {
    super("Cannot deactivate the last active system admin.", 409);
    this.name = "LastActiveSystemAdminDeactivationError";
  }
}

export class SelfSystemAdminDemotionError extends AuthError {
  constructor() {
    super("System admins cannot remove their own admin flag.", 409);
    this.name = "SelfSystemAdminDemotionError";
  }
}

export class SelfDeactivationError extends AuthError {
  constructor() {
    super("System admins cannot deactivate themselves.", 409);
    this.name = "SelfDeactivationError";
  }
}
