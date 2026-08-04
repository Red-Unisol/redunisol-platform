import type { ErrorRequestHandler } from "express";

import { env } from "../config/env";

type HttpError = Error & {
  status?: number;
  statusCode?: number;
};

export const errorHandler: ErrorRequestHandler = (error: HttpError, _req, res, _next) => {
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
