import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAuthApp } from "../app.js";
import { testAuthConfig } from "./test-config.js";

describe("auth server http app", () => {
  it.each(["/health", "/health/live"])(
    "returns liveness status from %s without checking dependencies",
    async (path) => {
      const readinessChecks = {
        database: vi.fn(async () => {
          throw new Error("database unavailable");
        }),
        messageBroker: vi.fn(async () => {
          throw new Error("broker unavailable");
        }),
      };
      const response = await request(
        createAuthApp({ config: testAuthConfig, readinessChecks }),
      ).get(path);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: "ok",
        service: "auth-server",
      });
      expect(response.headers["x-request-id"]).toEqual(expect.any(String));
      expect(readinessChecks.database).not.toHaveBeenCalled();
      expect(readinessChecks.messageBroker).not.toHaveBeenCalled();
    },
  );

  it("returns ready when the database and message broker are reachable", async () => {
    const response = await request(
      createAuthApp({
        config: testAuthConfig,
        readinessChecks: {
          database: async () => undefined,
          messageBroker: async () => undefined,
        },
      }),
    ).get("/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ready",
      service: "auth-server",
      checks: {
        database: { status: "up" },
        messageBroker: { status: "up" },
      },
    });
  });

  it("returns not-ready and identifies failed components without leaking errors", async () => {
    const response = await request(
      createAuthApp({
        config: testAuthConfig,
        readinessChecks: {
          database: async () => undefined,
          messageBroker: async () => {
            throw new Error("amqp://user:secret@internal-broker:5672");
          },
        },
      }),
    ).get("/health/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "not_ready",
      service: "auth-server",
      checks: {
        database: { status: "up" },
        messageBroker: { status: "down" },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("secret");
    expect(JSON.stringify(response.body)).not.toContain("internal-broker");
  });

  it("becomes ready after a dependency recovers without restarting", async () => {
    let brokerAvailable = false;
    const app = createAuthApp({
      config: testAuthConfig,
      readinessChecks: {
        database: async () => undefined,
        messageBroker: async () => {
          if (!brokerAvailable) throw new Error("broker unavailable");
        },
      },
    });

    expect((await request(app).get("/health/ready")).status).toBe(503);
    brokerAvailable = true;
    expect((await request(app).get("/health/ready")).status).toBe(200);
  });

  it("bounds slow readiness checks with a timeout", async () => {
    const response = await request(
      createAuthApp({
        config: { ...testAuthConfig, healthReadinessTimeoutMs: 10 },
        readinessChecks: {
          database: () => new Promise<void>(() => undefined),
          messageBroker: async () => undefined,
        },
      }),
    ).get("/health/ready");

    expect(response.status).toBe(503);
    expect(response.body.checks.database).toEqual({ status: "down" });
    expect(response.body.checks.messageBroker).toEqual({ status: "up" });
  });

  it("returns the standard error envelope for unknown routes", async () => {
    const response = await request(createAuthApp({ config: testAuthConfig })).get("/missing-route");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Resource tidak ditemukan",
        requestId: expect.any(String),
      },
    });
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });
});
