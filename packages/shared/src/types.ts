export type StandardErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CREDENTIALS"
  | "INVALID_CLIENT"
  | "INVALID_GRANT"
  | "ACCESS_DENIED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export interface StandardErrorResponse {
  error: {
    code: StandardErrorCode;
    message: string;
    requestId: string;
  };
}

export interface UserInfoResponse {
  sub: string;
  name: string;
  email: string;
  groups: string[];
  centralSessionId: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export interface RevocationEventPayload {
  eventId: string;
  eventType: "SessionRevoked" | "PasswordChanged" | "AccessPolicyChanged";
  userId: string;
  centralSessionId: string | null;
  applicationId: string | null;
  reason: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}
