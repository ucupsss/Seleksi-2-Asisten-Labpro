import "dotenv/config";
import { z } from "zod";

const authConfigSchema = z.object({
  AUTH_SERVER_PORT: z.coerce.number().int().positive().default(4001),
  AUTH_DATABASE_URL: z
    .string()
    .default("postgresql://sso:sso@localhost:5432/sso_auth"),
  AUTH_WEB_URL: z.string().url().default("http://localhost:4000"),
  AUTH_WEB_ORIGINS: z.string().default("http://localhost:4000"),
  COOKIE_SECRET: z.string().min(1).default("dev-cookie-secret"),
  SSO_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60),
});

export interface AuthConfig {
  port: number;
  authDatabaseUrl: string;
  authWebUrl: string;
  allowedWebOrigins: string[];
  cookieName: "sso_session";
  cookieSecret: string;
  ssoSessionTtlMinutes: number;
}

export function loadAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const parsed = authConfigSchema.parse(env);

  return {
    port: parsed.AUTH_SERVER_PORT,
    authDatabaseUrl: parsed.AUTH_DATABASE_URL,
    authWebUrl: parsed.AUTH_WEB_URL,
    allowedWebOrigins: parsed.AUTH_WEB_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    cookieName: "sso_session",
    cookieSecret: parsed.COOKIE_SECRET,
    ssoSessionTtlMinutes: parsed.SSO_SESSION_TTL_MINUTES,
  };
}
