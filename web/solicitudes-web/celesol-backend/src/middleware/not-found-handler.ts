import type { RequestHandler } from "express";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: {
      message: "Route not found",
      statusCode: 404,
    },
  });
};
