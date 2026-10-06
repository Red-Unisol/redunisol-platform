import type { ErrorRequestHandler } from "express";

import { env } from "../config/env";

type HttpError = Error & {
  status?: number;
  statusCode?: number;
};

export const errorHandler: ErrorRequestHandler = (error: HttpError, _req, res, _next) => {
  // A reservation freezes financial inputs and its receipt, including writes
  // from the regular UI. The database enforces this across concurrent requests.
  if (error.message.includes("BEEX_TRANSFERENCIAS_LOCKED")) {
    res.status(409).json({ error: {
      code: "TRANSFERENCIAS_LOCKED",
      message: "Los datos quedaron fijados por un desembolso. Revisar la operación en Transferencias.",
      statusCode: 409,
    } });
    return;
  }
  const statusCode = error.statusCode ?? error.status ?? 500;
  const message =
    statusCode === 500
      ? "Internal server error"
      : error.message || "Request failed";
  const response: {
    error: {
      code: string;
      message: string;
      stack?: string;
      statusCode: number;
    };
  } = {
    error: {
      code: error.name,
      message,
      statusCode,
    },
  };

  if (env.NODE_ENV !== "production" && error.stack) {
    response.error.stack = error.stack;
  }

  res.status(statusCode).json({
    error: response.error,
  });
};
