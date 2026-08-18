import type { AuthConfig } from "../config.js";

export const testAuthConfig: AuthConfig = {
  port: 4001,
  authDatabaseUrl: "postgresql://test:test@localhost:5432/test",
  authWebUrl: "http://localhost:4000",
  allowedWebOrigins: ["http://localhost:4000"],
  cookieName: "sso_session",
  cookieSecret: "test-cookie-secret",
  ssoSessionTtlMinutes: 60,
};
