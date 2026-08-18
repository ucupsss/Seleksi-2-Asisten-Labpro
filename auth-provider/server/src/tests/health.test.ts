import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAuthApp } from "../app.js";
import { testAuthConfig } from "./test-config.js";

describe("auth server http app", () => {
  it("returns health status", async () => {
    const response = await request(createAuthApp({ config: testAuthConfig })).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "auth-server",
    });
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
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
