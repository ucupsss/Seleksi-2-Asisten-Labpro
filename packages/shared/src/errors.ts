import type { StandardErrorCode, StandardErrorResponse } from "./types.js";

export function createStandardError(
  code: StandardErrorCode,
  message: string,
  requestId: string,
): StandardErrorResponse {
  return { error: { code, message, requestId } };
}
