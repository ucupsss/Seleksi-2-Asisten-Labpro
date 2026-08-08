import type { StandardErrorCode } from "@sso/shared";

export class HttpError extends Error {
  readonly status: number;
  readonly code: StandardErrorCode;

  constructor(status: number, code: StandardErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFoundError(): HttpError {
  return new HttpError(404, "NOT_FOUND", "Resource tidak ditemukan");
}
