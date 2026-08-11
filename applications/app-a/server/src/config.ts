import "dotenv/config";
import type { RelyingAppConfig } from "@sso/relying-app-server";

function numberFromEnv(value: string | undefined, fallback: number) {
  return value ? Number(value) : fallback;
}

function listFromEnv(value: string | undefined, fallback: string[]) {
  return value
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : fallback;
}

export function loadAppAConfig(): RelyingAppConfig & { port: number } {
  return {
    appKey: "app-a",
    appName: "App A",
    port: numberFromEnv(process.env.APP_A_SERVER_PORT, 4101),
    authBaseUrl: process.env.AUTH_BASE_URL ?? "http://localhost:4000",
    webHomeUrl: process.env.APP_A_WEB_HOME_URL ?? "http://localhost:5173",
    clientId: process.env.APP_A_CLIENT_ID ?? "app-a-client",
    redirectUri:
      process.env.APP_A_REDIRECT_URI ??
      "http://localhost:4101/auth/callback",
    localSessionCookieName:
      process.env.APP_A_SESSION_COOKIE_NAME ?? "app_a_session",
    internalSecret: process.env.INTERNAL_LOGOUT_SECRET ?? "dev-internal-secret",
    localSessionTtlMinutes: numberFromEnv(
      process.env.LOCAL_SESSION_TTL_MINUTES,
      60,
    ),
    pendingLoginTtlMinutes: numberFromEnv(
      process.env.PENDING_LOGIN_TTL_MINUTES,
      5,
    ),
    allowedWebOrigins: listFromEnv(process.env.APP_A_WEB_ORIGINS, [
      "http://localhost:5173",
    ]),
  };
}
