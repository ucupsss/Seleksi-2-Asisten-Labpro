import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "../config.js";

describe("loadAuthConfig", () => {
  it("uses non-secret local defaults while requiring credentials", () => {
    const config = loadAuthConfig({
      AUTH_DATABASE_URL: "postgresql://user:password@localhost:5432/sso_auth",
      RABBITMQ_URL: "amqp://user:password@localhost:5672",
      COOKIE_SECRET: "local-cookie-secret",
    });

    expect(config).toEqual({
      port: 4001,
      authDatabaseUrl: "postgresql://user:password@localhost:5432/sso_auth",
      rabbitUrl: "amqp://user:password@localhost:5672",
      authWebUrl: "http://localhost:4000",
      allowedWebOrigins: ["http://localhost:4000"],
      cookieName: "sso_session",
      cookieSecret: "local-cookie-secret",
      ssoSessionTtlMinutes: 60,
      healthReadinessTimeoutMs: 2000,
    });
  });

  it("parses configured values from environment variables", () => {
    const config = loadAuthConfig({
      AUTH_SERVER_PORT: "4999",
      AUTH_DATABASE_URL: "postgresql://custom:custom@db:5432/custom_auth",
      RABBITMQ_URL: "amqp://custom:custom@broker:5672",
      AUTH_WEB_URL: "http://localhost:4998",
      AUTH_WEB_ORIGINS: "http://localhost:4998,http://localhost:4997",
      COOKIE_SECRET: "configured-cookie-secret",
      SSO_SESSION_TTL_MINUTES: "120",
      HEALTH_READINESS_TIMEOUT_MS: "3500",
    });

    expect(config.port).toBe(4999);
    expect(config.authDatabaseUrl).toBe(
      "postgresql://custom:custom@db:5432/custom_auth",
    );
    expect(config.authWebUrl).toBe("http://localhost:4998");
    expect(config.rabbitUrl).toBe("amqp://custom:custom@broker:5672");
    expect(config.allowedWebOrigins).toEqual([
      "http://localhost:4998",
      "http://localhost:4997",
    ]);
    expect(config.cookieSecret).toBe("configured-cookie-secret");
    expect(config.ssoSessionTtlMinutes).toBe(120);
    expect(config.healthReadinessTimeoutMs).toBe(3500);
  });

  it("rejects missing credentials", () => {
    expect(() => loadAuthConfig({})).toThrow();
  });

  it("requires the message broker URL for readiness checks", () => {
    expect(() =>
      loadAuthConfig({
        AUTH_DATABASE_URL: "postgresql://user:password@localhost:5432/sso_auth",
        COOKIE_SECRET: "local-cookie-secret",
      }),
    ).toThrow();
  });
});
