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

export function loadAppBConfig(): RelyingAppConfig & { port: number } {
  return {
    appKey: "app-b",
    appName: "App B",
    port: numberFromEnv(process.env.APP_B_SERVER_PORT, 4201),
    authBaseUrl: process.env.AUTH_BASE_URL ?? "http://localhost:4001",
    authPublicBaseUrl:
      process.env.AUTH_PUBLIC_BASE_URL ??
      process.env.AUTH_BASE_URL ??
      "http://localhost:4001",
    webHomeUrl: process.env.APP_B_WEB_HOME_URL ?? "http://localhost:4200",
    clientId: process.env.APP_B_CLIENT_ID ?? "app-b-client",
    redirectUri:
      process.env.APP_B_REDIRECT_URI ??
      "http://localhost:4201/auth/callback",
    localSessionCookieName:
      process.env.APP_B_SESSION_COOKIE_NAME ?? "app_b_session",
    internalSecret: process.env.INTERNAL_LOGOUT_SECRET ?? "dev-internal-secret",
    localSessionTtlMinutes: numberFromEnv(
      process.env.LOCAL_SESSION_TTL_MINUTES,
      60,
    ),
    pendingLoginTtlMinutes: numberFromEnv(
      process.env.PENDING_LOGIN_TTL_MINUTES,
      5,
    ),
    allowedWebOrigins: listFromEnv(process.env.APP_B_WEB_ORIGINS, [
      "http://localhost:4200",
    ]),
  };
}
