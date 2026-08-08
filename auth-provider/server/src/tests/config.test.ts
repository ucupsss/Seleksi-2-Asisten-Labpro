import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "../config.js";

describe("loadAuthConfig", () => {
  it("uses safe local defaults for development", () => {
    const config = loadAuthConfig({});

    expect(config).toEqual({
      port: 4001,
      authDatabaseUrl: "postgresql://sso:sso@localhost:5432/sso_auth",
      authWebUrl: "http://localhost:4000",
      allowedWebOrigins: ["http://localhost:4000"],
      cookieName: "sso_session",
      cookieSecret: "dev-cookie-secret",
      ssoSessionTtlMinutes: 60,
    });
  });

  it("parses configured values from environment variables", () => {
    const config = loadAuthConfig({
      AUTH_SERVER_PORT: "4999",
      AUTH_DATABASE_URL: "postgresql://custom:custom@db:5432/custom_auth",
      AUTH_WEB_URL: "http://localhost:4998",
      AUTH_WEB_ORIGINS: "http://localhost:4998,http://localhost:4997",
      COOKIE_SECRET: "local-secret",
      SSO_SESSION_TTL_MINUTES: "120",
    });

    expect(config.port).toBe(4999);
    expect(config.authDatabaseUrl).toBe(
      "postgresql://custom:custom@db:5432/custom_auth",
    );
    expect(config.authWebUrl).toBe("http://localhost:4998");
    expect(config.allowedWebOrigins).toEqual([
      "http://localhost:4998",
      "http://localhost:4997",
    ]);
    expect(config.cookieSecret).toBe("local-secret");
    expect(config.ssoSessionTtlMinutes).toBe(120);
  });
});
