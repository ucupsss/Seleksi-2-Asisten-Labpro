import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const requestIdHeader = "x-request-id";

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const incomingRequestId = req.header(requestIdHeader);
  const requestId = incomingRequestId?.trim() || randomUUID();

  res.locals.requestId = requestId;
  res.setHeader(requestIdHeader, requestId);
  next();
}

export function getRequestId(res: Response): string {
  return String(res.locals.requestId ?? randomUUID());
}
