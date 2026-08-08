import { createStandardError } from "@sso/shared";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../errors.js";
import { getRequestId } from "./request-id.js";

export function notFoundMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction,
) {
  next(new HttpError(404, "NOT_FOUND", "Resource tidak ditemukan"));
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const requestId = getRequestId(res);

  if (error instanceof HttpError) {
    res
      .status(error.status)
      .json(createStandardError(error.code, error.message, requestId));
    return;
  }

  res
    .status(500)
    .json(
      createStandardError(
        "INTERNAL_ERROR",
        "Terjadi kesalahan pada server",
        requestId,
      ),
    );
}
