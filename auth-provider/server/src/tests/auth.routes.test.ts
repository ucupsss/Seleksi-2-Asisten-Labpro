import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAuthApp } from "../app.js";
import { HttpError } from "../errors.js";
import type { AuthService } from "../services/auth.service.js";

function createFakeAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    loginWithPassword: async () => ({
      sessionToken: "raw-session-token",
      sessionId: "session-1",
      expiresAt: new Date("2026-08-09T11:00:00.000Z"),
      user: {
        id: "user-1",
        name: "Student User",
        email: "student@example.com",
      },
    }),
    getCurrentSsoSession: async () => null,
    logout: async () => {},
    ...overrides,
  };
}

function readSetCookieHeader(response: request.Response): string {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? value.join(";") : String(value ?? "");
}

describe("auth routes", () => {
  it("logs in and sets central session cookie", async () => {
    const response = await request(
      createAuthApp({ authService: createFakeAuthService() }),
    )
      .post("/auth/login")
      .send({
        email: "student@example.com",
        password: "password123",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: "user-1",
        name: "Student User",
        email: "student@example.com",
      },
    });
    expect(readSetCookieHeader(response)).toContain(
      "sso_session=raw-session-token",
    );
    expect(readSetCookieHeader(response)).toContain("HttpOnly");
  });

  it("returns standard error when login fails", async () => {
    const response = await request(
      createAuthApp({
        authService: createFakeAuthService({
          loginWithPassword: async () => {
            throw new HttpError(
              401,
              "INVALID_CREDENTIALS",
              "Email atau password tidak valid",
            );
          },
        }),
      }),
    )
      .post("/auth/login")
      .send({
        email: "student@example.com",
        password: "wrong-password",
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Email atau password tidak valid",
        requestId: expect.any(String),
      },
    });
  });

  it("logs out and clears central session cookie", async () => {
    let receivedSessionToken: string | undefined;

    const response = await request(
      createAuthApp({
        authService: createFakeAuthService({
          logout: async (sessionToken) => {
            receivedSessionToken = sessionToken;
          },
        }),
      }),
    )
      .post("/auth/logout")
      .set("Cookie", ["sso_session=raw-session-token"]);

    expect(response.status).toBe(204);
    expect(receivedSessionToken).toBe("raw-session-token");
    expect(readSetCookieHeader(response)).toContain("sso_session=;");
  });
});
