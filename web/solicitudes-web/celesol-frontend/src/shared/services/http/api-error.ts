export class ApiError extends Error {
  cause?: unknown;
  code?: string;
  rawBody?: string;
  status?: number;

  constructor(
    message: string,
    status?: number,
    cause?: unknown,
    rawBody?: string,
    code?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.cause = cause;
    this.rawBody = rawBody;
    this.code = code;
  }
}
