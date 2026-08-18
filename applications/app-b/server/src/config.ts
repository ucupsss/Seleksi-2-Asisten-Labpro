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

function requiredEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadAppBConfig(
  env: NodeJS.ProcessEnv = process.env,
): RelyingAppConfig & { port: number } {
  return {
    appKey: "app-b",
    appName: "App B",
    port: numberFromEnv(env.APP_B_SERVER_PORT, 4201),
    authBaseUrl: env.AUTH_BASE_URL ?? "http://localhost:4001",
    authPublicBaseUrl:
      env.AUTH_PUBLIC_BASE_URL ??
      env.AUTH_BASE_URL ??
      "http://localhost:4001",
    webHomeUrl: env.APP_B_WEB_HOME_URL ?? "http://localhost:4200",
    clientId: env.APP_B_CLIENT_ID ?? "app-b-client",
    redirectUri:
      env.APP_B_REDIRECT_URI ??
      "http://localhost:4201/auth/callback",
    localSessionCookieName:
      env.APP_B_SESSION_COOKIE_NAME ?? "app_b_session",
    internalSecret: requiredEnv(env, "INTERNAL_LOGOUT_SECRET"),
    localSessionTtlMinutes: numberFromEnv(
      env.LOCAL_SESSION_TTL_MINUTES,
      60,
    ),
    pendingLoginTtlMinutes: numberFromEnv(
      env.PENDING_LOGIN_TTL_MINUTES,
      5,
    ),
    allowedWebOrigins: listFromEnv(env.APP_B_WEB_ORIGINS, [
      "http://localhost:4200",
    ]),
  };
}
