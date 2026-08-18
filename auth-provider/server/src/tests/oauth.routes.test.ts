import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAuthApp } from "../app.js";
import { testAuthConfig } from "./test-config.js";
import type { AuthService } from "../services/auth.service.js";
import type { OauthService } from "../services/oauth.service.js";

function createFakeAuthService(
  currentSession:
    | {
        id: string;
        user: { id: string; name: string; email: string; groups: string[] };
      }
    | null = {
      id: "session-1",
      user: {
        id: "user-1",
        name: "Student User",
        email: "student@example.com",
        groups: ["app-a-users"],
      },
    },
): AuthService {
  return {
    loginWithPassword: async () => {
      throw new Error("unused");
    },
    getCurrentSsoSession: async () => currentSession,
    logout: async () => {},
  };
}

function createFakeOauthService(): OauthService {
  return {
    createAuthorizationCode: async () => ({
      code: "raw-code",
      redirectTo:
        "http://localhost:4101/auth/callback?code=raw-code&state=state-1",
    }),
    exchangeAuthorizationCode: async () => ({
      access_token: "raw-access-token",
      token_type: "Bearer",
      expires_in: 1800,
    }),
    getUserInfo: async () => ({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-a-users"],
      centralSessionId: "session-1",
    }),
  };
}

describe("oauth routes", () => {
  it("redirects authorize request to app callback when central session exists", async () => {
    const response = await request(
      createAuthApp({
        config: testAuthConfig,
        authService: createFakeAuthService(),
        oauthService: createFakeOauthService(),
      }),
    )
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: "app-a-client",
        redirect_uri: "http://localhost:4101/auth/callback",
        state: "state-1",
        code_challenge: "challenge-1",
        code_challenge_method: "S256",
      })
      .set("Cookie", ["sso_session=raw-session-token"]);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      "http://localhost:4101/auth/callback?code=raw-code&state=state-1",
    );
  });

  it("redirects authorize request to login when central session is missing", async () => {
    const response = await request(
      createAuthApp({
        config: testAuthConfig,
        authService: createFakeAuthService(null),
        oauthService: createFakeOauthService(),
      }),
    )
      .get("/oauth/authorize")
      .query({
        response_type: "code",
        client_id: "app-a-client",
        redirect_uri: "http://localhost:4101/auth/callback",
        state: "state-1",
        code_challenge: "challenge-1",
        code_challenge_method: "S256",
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("http://localhost:4000/login");
    expect(response.headers.location).toContain("returnTo=");
  });

  it("exchanges authorization code for token", async () => {
    const response = await request(
      createAuthApp({
        config: testAuthConfig,
        authService: createFakeAuthService(),
        oauthService: createFakeOauthService(),
      }),
    )
      .post("/oauth/token")
      .send({
        grant_type: "authorization_code",
        code: "raw-code",
        client_id: "app-a-client",
        redirect_uri: "http://localhost:4101/auth/callback",
        code_verifier: "verifier-1",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      access_token: "raw-access-token",
      token_type: "Bearer",
      expires_in: 1800,
    });
  });

  it("returns userinfo for bearer token", async () => {
    const response = await request(
      createAuthApp({
        config: testAuthConfig,
        authService: createFakeAuthService(),
        oauthService: createFakeOauthService(),
      }),
    )
      .get("/oauth/userinfo")
      .set("Authorization", "Bearer raw-access-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-a-users"],
      centralSessionId: "session-1",
    });
  });
});
