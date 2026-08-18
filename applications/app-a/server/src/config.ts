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

export function loadAppAConfig(
  env: NodeJS.ProcessEnv = process.env,
): RelyingAppConfig & { port: number } {
  return {
    appKey: "app-a",
    appName: "App A",
    port: numberFromEnv(env.APP_A_SERVER_PORT, 4101),
    authBaseUrl: env.AUTH_BASE_URL ?? "http://localhost:4001",
    authPublicBaseUrl:
      env.AUTH_PUBLIC_BASE_URL ??
      env.AUTH_BASE_URL ??
      "http://localhost:4001",
    webHomeUrl: env.APP_A_WEB_HOME_URL ?? "http://localhost:4100",
    clientId: env.APP_A_CLIENT_ID ?? "app-a-client",
    redirectUri:
      env.APP_A_REDIRECT_URI ??
      "http://localhost:4101/auth/callback",
    localSessionCookieName:
      env.APP_A_SESSION_COOKIE_NAME ?? "app_a_session",
    internalSecret: requiredEnv(env, "INTERNAL_LOGOUT_SECRET"),
    localSessionTtlMinutes: numberFromEnv(
      env.LOCAL_SESSION_TTL_MINUTES,
      60,
    ),
    pendingLoginTtlMinutes: numberFromEnv(
      env.PENDING_LOGIN_TTL_MINUTES,
      5,
    ),
    allowedWebOrigins: listFromEnv(env.APP_A_WEB_ORIGINS, [
      "http://localhost:4100",
    ]),
  };
}
