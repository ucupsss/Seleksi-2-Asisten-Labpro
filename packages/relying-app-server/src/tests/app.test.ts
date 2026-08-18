import request from "supertest";
import { describe, expect, it } from "vitest";
import type { UserInfoResponse } from "@sso/shared";
import { createAppServer } from "../app.js";
import type { OAuthClient } from "../oauth-client.js";
import { createLocalSessionService } from "../local-session.service.js";
import type {
  LocalSessionRecord,
  LocalSessionRepository,
  ProfileRecord,
} from "../local-session.service.js";
import type { RelyingAppConfig } from "../config.js";

const config: RelyingAppConfig = {
  appKey: "app-a",
  appName: "App A",
  authBaseUrl: "http://localhost:4000",
  authPublicBaseUrl: "http://localhost:4000",
  webHomeUrl: "http://localhost:5173",
  clientId: "app-a-client",
  redirectUri: "http://localhost:4101/auth/callback",
  localSessionCookieName: "app_a_session",
  internalSecret: "internal-secret",
  localSessionTtlMinutes: 60,
  pendingLoginTtlMinutes: 5,
  allowedWebOrigins: ["http://localhost:5173"],
};

function createRepository() {
  const sessions = new Map<string, LocalSessionRecord>();
  const profiles = new Map<string, ProfileRecord>();
  const processedEvents = new Set<string>();
  const activityLogs: Array<{
    id: string;
    appKey: string;
    eventType: string;
    message: string;
    requestId: string | null;
    correlationId: string | null;
    createdAt: Date;
  }> = [];

  const repository: LocalSessionRepository = {
    withTransaction: async (work) => work(repository),
    createLocalSession: async (input) => {
      const session = {
        id: `session-${sessions.size + 1}`,
        appKey: input.appKey,
        sessionTokenHash: input.sessionTokenHash,
        externalUserId: input.externalUserId,
        centralSessionId: input.centralSessionId,
        status: "active" as const,
        createdAt: new Date("2026-08-09T10:00:00.000Z"),
        expiresAt: input.expiresAt,
        revokedAt: null,
      };
      sessions.set(session.sessionTokenHash, session);
      return session;
    },
    findSessionByHash: async (input) => {
      const session = sessions.get(input.sessionTokenHash);
      return session?.appKey === input.appKey ? session : null;
    },
    markSessionExpired: async (input) => {
      const session = sessions.get(input.sessionTokenHash);
      if (session?.appKey === input.appKey && session.status === "active") {
        session.status = "expired";
      }
    },
    findActiveSessionByHash: async (input) => {
      const session = sessions.get(input.sessionTokenHash);
      if (!session || session.appKey !== input.appKey) return null;
      if (session.status !== "active" || session.revokedAt) return null;
      const profile = profiles.get(`${session.appKey}:${session.externalUserId}`);
      return profile ? { ...session, profile } : null;
    },
    revokeSessionByHash: async (input) => {
      const session = sessions.get(input.sessionTokenHash);
      if (!session || session.appKey !== input.appKey) return null;
      session.status = "revoked";
      session.revokedAt = new Date("2026-08-09T10:05:00.000Z");
      return session;
    },
    upsertProfile: async (input) => {
      const profile = {
        appKey: input.appKey,
        externalUserId: input.externalUserId,
        name: input.name,
        email: input.email,
        groups: input.groups,
        syncedAt: input.syncedAt,
      };
      profiles.set(`${input.appKey}:${input.externalUserId}`, profile);
      return profile;
    },
    createActivityLog: async (input) => {
      activityLogs.push({
        id: `log-${activityLogs.length + 1}`,
        appKey: input.appKey,
        eventType: input.eventType,
        message: input.message,
        requestId: input.requestId ?? null,
        correlationId: input.correlationId ?? null,
        createdAt: new Date("2026-08-09T10:00:00.000Z"),
      });
    },
    listActivityLogs: async (input) =>
      activityLogs
        .filter((log) => log.appKey === input.appKey)
        .reverse()
        .slice(0, input.limit),
    findProcessedEvent: async (input) =>
      processedEvents.has(`${input.appKey}:${input.eventId}`)
        ? { appKey: input.appKey, eventId: input.eventId }
        : null,
    tryInsertProcessedEvent: async (input) => {
      const key = `${input.appKey}:${input.eventId}`;
      if (processedEvents.has(key)) return false;
      processedEvents.add(key);
      return true;
    },
    updateProcessedEventResult: async () => {},
    listProcessedEvents: async (input) => [
      {
        appKey: input.appKey,
        eventId: "event-1",
        eventType: "SessionRevoked",
        result: "success",
        processedAt: new Date("2026-08-09T10:05:00.000Z"),
      },
    ].slice(0, input.limit),
    revokeSessionsForLogoutEvent: async (input) => {
      let count = 0;
      for (const session of sessions.values()) {
        if (
          session.appKey === input.appKey &&
          (input.centralSessionId === null ||
            session.centralSessionId === input.centralSessionId) &&
          session.externalUserId === input.externalUserId &&
          session.status === "active"
        ) {
          session.status = "revoked";
          session.revokedAt = new Date("2026-08-09T10:05:00.000Z");
          count += 1;
        }
      }
      return count;
    },
  };

  return { repository };
}

function createOAuthClient(): OAuthClient {
  const userInfo: UserInfoResponse = {
    sub: "user-1",
    name: "Student User",
    email: "student@example.com",
    groups: ["app-a-users"],
    centralSessionId: "central-session-1",
  };

  return {
    exchangeCode: async () => ({
      access_token: "raw-access-token",
      token_type: "Bearer",
      expires_in: 1800,
    }),
    getUserInfo: async () => userInfo,
  };
}

function createTestApp() {
  const { repository } = createRepository();
  const localSessionService = createLocalSessionService({
    appKey: config.appKey,
    repository,
    generateToken: () => "raw-local-session-token",
    now: () => new Date("2026-08-09T10:00:00.000Z"),
    sessionTtlMinutes: config.localSessionTtlMinutes,
  });

  return createAppServer(config, {
    oauthClient: createOAuthClient(),
    localSessionService,
    generateState: () => "state-1",
    generatePkceVerifier: () => "verifier-1",
  });
}

function getCookie(response: request.Response, name: string) {
  const cookies = response.headers["set-cookie"];
  const cookieList = Array.isArray(cookies) ? cookies : [cookies];
  return cookieList.find((cookie) => cookie?.startsWith(`${name}=`));
}

describe("relying app server", () => {
  it("returns health status for compose health checks", async () => {
    const response = await request(createTestApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      appKey: "app-a",
      appName: "App A",
    });
  });

  it("starts login by returning authorize URL and pending cookies", async () => {
    const response = await request(createTestApp()).post("/login/start");

    expect(response.status).toBe(200);
    expect(response.body.redirectTo).toContain(
      "http://localhost:4000/oauth/authorize",
    );
    expect(response.body.redirectTo).toContain("client_id=app-a-client");
    expect(response.body.redirectTo).toContain("state=state-1");
    expect(getCookie(response, "app-a_oauth_state")).toContain("HttpOnly");
    expect(getCookie(response, "app-a_pkce_verifier")).toContain("HttpOnly");
  });

  it("handles callback by creating local session and redirecting home", async () => {
    const app = createTestApp();
    const response = await request(app)
      .get("/auth/callback")
      .query({ code: "raw-code", state: "state-1" })
      .set("Cookie", [
        "app-a_oauth_state=state-1",
        "app-a_pkce_verifier=verifier-1",
      ]);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://localhost:5173");
    expect(getCookie(response, "app_a_session")).toContain("HttpOnly");
    expect(getCookie(response, "app-a_oauth_state")).toContain(
      "Expires=Thu, 01 Jan 1970",
    );
  });

  it("returns authenticated session from local session cookie", async () => {
    const app = createTestApp();
    const callback = await request(app)
      .get("/auth/callback")
      .query({ code: "raw-code", state: "state-1" })
      .set("Cookie", [
        "app-a_oauth_state=state-1",
        "app-a_pkce_verifier=verifier-1",
      ]);
    const sessionCookie = getCookie(callback, "app_a_session")?.split(";")[0];

    const response = await request(app)
      .get("/session")
      .set("Cookie", [sessionCookie ?? ""]);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("authenticated");
    expect(response.body.user).toEqual({
      name: "Student User",
      email: "student@example.com",
      groups: ["app-a-users"],
    });
  });

  it("returns database-backed activity logs for an authenticated local session", async () => {
    const app = createTestApp();
    const callback = await request(app)
      .get("/auth/callback")
      .query({ code: "raw-code", state: "state-1" })
      .set("Cookie", [
        "app-a_oauth_state=state-1",
        "app-a_pkce_verifier=verifier-1",
      ]);
    const sessionCookie = getCookie(callback, "app_a_session")?.split(";")[0];

    const response = await request(app)
      .get("/activity-logs?limit=10")
      .set("Cookie", [sessionCookie ?? ""])
      .set("x-request-id", "request-activity-1");

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(4);
    expect(response.body.logs.map((log: { eventType: string }) => log.eventType))
      .toEqual([
        "local_login_success",
        "userinfo_received",
        "authorization_code_exchanged",
        "authorization_code_received",
      ]);
    expect(response.body.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appKey: "app-a",
          correlationId: "state-1",
          requestId: expect.any(String),
        }),
      ]),
    );
  });

  it("returns database-backed processed events for an authenticated local session", async () => {
    const app = createTestApp();
    const callback = await request(app)
      .get("/auth/callback")
      .query({ code: "raw-code", state: "state-1" })
      .set("Cookie", [
        "app-a_oauth_state=state-1",
        "app-a_pkce_verifier=verifier-1",
      ]);
    const sessionCookie = getCookie(callback, "app_a_session")?.split(";")[0];

    const response = await request(app)
      .get("/processed-events")
      .set("Cookie", [sessionCookie ?? ""]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      events: [
        {
          appKey: "app-a",
          eventId: "event-1",
          eventType: "SessionRevoked",
          result: "success",
          processedAt: "2026-08-09T10:05:00.000Z",
        },
      ],
    });
  });

  it("does not expose operational data without an active local session", async () => {
    const response = await request(createTestApp()).get("/activity-logs");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("revokes local session without calling Auth Provider logout", async () => {
    const app = createTestApp();
    const callback = await request(app)
      .get("/auth/callback")
      .query({ code: "raw-code", state: "state-1" })
      .set("Cookie", [
        "app-a_oauth_state=state-1",
        "app-a_pkce_verifier=verifier-1",
      ]);
    const sessionCookie = getCookie(callback, "app_a_session")?.split(";")[0];

    const logout = await request(app)
      .post("/logout")
      .set("Cookie", [sessionCookie ?? ""]);
    const session = await request(app)
      .get("/session")
      .set("Cookie", [sessionCookie ?? ""]);

    expect(logout.status).toBe(204);
    expect(getCookie(logout, "app_a_session")).toContain(
      "Expires=Thu, 01 Jan 1970",
    );
    expect(session.body).toMatchObject({
      status: "revoked",
      session: { status: "revoked" },
    });
  });

  it("requires internal secret for internal logout", async () => {
    const response = await request(createTestApp())
      .post("/internal/logout")
      .send({
        eventId: "event-1",
        eventType: "SessionRevoked",
        userId: "user-1",
        centralSessionId: "central-session-1",
        reason: "sso_logout",
      });

    expect(response.status).toBe(401);
  });

  it("accepts user-wide password change revocation events", async () => {
    const response = await request(createTestApp())
      .post("/internal/logout")
      .set("x-internal-secret", "internal-secret")
      .send({
        eventId: "event-password-1",
        eventType: "PasswordChanged",
        userId: "user-1",
        centralSessionId: null,
        applicationId: null,
        reason: "password_changed",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      alreadyProcessed: false,
      revokedCount: 0,
    });
  });

  it("rejects session revocation without a central session id", async () => {
    const response = await request(createTestApp())
      .post("/internal/logout")
      .set("x-internal-secret", "internal-secret")
      .send({
        eventId: "event-session-1",
        eventType: "SessionRevoked",
        userId: "user-1",
        centralSessionId: null,
        applicationId: null,
        reason: "sso_logout",
      });

    expect(response.status).toBe(400);
  });
});
