import { describe, expect, it } from "vitest";
import type {
  LocalSessionRecord,
  LocalSessionRepository,
  ProfileRecord,
} from "../local-session.service.js";
import { createLocalSessionService } from "../local-session.service.js";

function createRepository(appKey = "app-a") {
  const sessions = new Map<string, LocalSessionRecord>();
  const profiles = new Map<string, ProfileRecord>();
  const processedEvents = new Set<string>();
  const activityLogs: Array<{
    appKey: string;
    eventType: string;
    message: string;
    requestId?: string;
    correlationId?: string;
  }> = [];

  const repository: LocalSessionRepository = {
    withTransaction: async (work) => {
      const sessionSnapshot = new Map(
        [...sessions].map(([key, value]) => [key, { ...value }]),
      );
      const profileSnapshot = new Map(profiles);
      const processedSnapshot = new Set(processedEvents);
      const activityLength = activityLogs.length;
      try {
        return await work(repository);
      } catch (error) {
        sessions.clear();
        sessionSnapshot.forEach((value, key) => sessions.set(key, value));
        profiles.clear();
        profileSnapshot.forEach((value, key) => profiles.set(key, value));
        processedEvents.clear();
        processedSnapshot.forEach((value) => processedEvents.add(value));
        activityLogs.length = activityLength;
        throw error;
      }
    },
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
        appKey: input.appKey,
        eventType: input.eventType,
        message: input.message,
        requestId: input.requestId,
        correlationId: input.correlationId,
      });
    },
    listActivityLogs: async (input) =>
      activityLogs
        .filter((log) => log.appKey === input.appKey)
        .slice(0, input.limit)
        .map((log, index) => ({
          id: `log-${index + 1}`,
          appKey: log.appKey,
          eventType: log.eventType,
          message: log.message,
          requestId: log.requestId ?? null,
          correlationId: log.correlationId ?? null,
          createdAt: new Date("2026-08-09T10:00:00.000Z"),
        })),
    findProcessedEvent: async (input) =>
      processedEvents.has(`${input.appKey}:${input.eventId}`)
        ? { eventId: input.eventId, appKey: input.appKey }
        : null,
    tryInsertProcessedEvent: async (input) => {
      const key = `${input.appKey}:${input.eventId}`;
      if (processedEvents.has(key)) return false;
      processedEvents.add(key);
      return true;
    },
    updateProcessedEventResult: async () => {},
    listProcessedEvents: async (input) =>
      [...processedEvents]
        .filter((key) => key.startsWith(`${input.appKey}:`))
        .slice(0, input.limit)
        .map((key) => ({
          appKey: input.appKey,
          eventId: key.slice(input.appKey.length + 1),
          eventType: "SessionRevoked",
          result: "success",
          processedAt: new Date("2026-08-09T10:05:00.000Z"),
        })),
    revokeSessionsForLogoutEvent: async (input) => {
      let count = 0;
      for (const session of sessions.values()) {
        const appMatches = !input.appKey || session.appKey === input.appKey;
        const centralSessionMatches =
          input.centralSessionId === null ||
          session.centralSessionId === input.centralSessionId;
        const userMatches = session.externalUserId === input.externalUserId;

        if (
          appMatches &&
          centralSessionMatches &&
          userMatches &&
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

  const service = createLocalSessionService({
    appKey,
    repository,
    generateToken: () => "raw-local-session-token",
    now: () => new Date("2026-08-09T10:00:00.000Z"),
    sessionTtlMinutes: 60,
  });

  return {
    service,
    repository,
    sessions,
    profiles,
    processedEvents,
    activityLogs,
  };
}

describe("local session service", () => {
  it("creates local session after userinfo is available", async () => {
    const { service, sessions, profiles, activityLogs } = createRepository();

    const result = await service.createSessionFromUserInfo(
      {
        sub: "user-1",
        name: "Student User",
        email: "student@example.com",
        groups: ["app-a-users"],
        centralSessionId: "central-session-1",
      },
      { requestId: "request-1", correlationId: "state-1" },
    );

    expect(result.sessionToken).toBe("raw-local-session-token");
    expect(result.session.expiresAt.toISOString()).toBe(
      "2026-08-09T11:00:00.000Z",
    );
    expect(sessions.size).toBe(1);
    expect(profiles.get("app-a:user-1")).toMatchObject({
      name: "Student User",
      groups: ["app-a-users"],
    });
    expect(activityLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appKey: "app-a",
          eventType: "local_login_success",
          requestId: "request-1",
          correlationId: "state-1",
        }),
      ]),
    );
  });

  it("records an SSO activity stage with trace identifiers", async () => {
    const { service, activityLogs } = createRepository();

    await service.recordActivity({
      eventType: "authorization_code_received",
      message: "Authorization code received by the callback.",
      requestId: "request-2",
      correlationId: "state-2",
    });

    expect(activityLogs).toContainEqual({
      appKey: "app-a",
      eventType: "authorization_code_received",
      message: "Authorization code received by the callback.",
      requestId: "request-2",
      correlationId: "state-2",
    });
  });

  it("returns active session from valid cookie", async () => {
    const { service } = createRepository();
    await service.createSessionFromUserInfo({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-a-users"],
      centralSessionId: "central-session-1",
    });

    const session = await service.getCurrentSession("raw-local-session-token");

    expect(session).toEqual({
      status: "authenticated",
      user: {
        name: "Student User",
        email: "student@example.com",
        groups: ["app-a-users"],
      },
      session: {
        status: "active",
        createdAt: new Date("2026-08-09T10:00:00.000Z"),
        expiresAt: new Date("2026-08-09T11:00:00.000Z"),
      },
    });
  });

  it("revokes only matching app local session on local logout", async () => {
    const appA = createRepository("app-a");
    const appB = createRepository("app-b");
    await appA.service.createSessionFromUserInfo({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-a-users"],
      centralSessionId: "central-session-1",
    });
    await appB.service.createSessionFromUserInfo({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-b-users"],
      centralSessionId: "central-session-1",
    });

    await appA.service.logout("raw-local-session-token");

    expect([...appA.sessions.values()][0]?.status).toBe("revoked");
    expect([...appB.sessions.values()][0]?.status).toBe("active");
  });

  it("processes internal logout idempotently by event id", async () => {
    const { service, processedEvents } = createRepository();
    await service.createSessionFromUserInfo({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-a-users"],
      centralSessionId: "central-session-1",
    });

    const first = await service.processInternalLogout({
      eventId: "event-1",
      eventType: "SessionRevoked",
      externalUserId: "user-1",
      centralSessionId: "central-session-1",
      reason: "sso_logout",
    });
    const second = await service.processInternalLogout({
      eventId: "event-1",
      eventType: "SessionRevoked",
      externalUserId: "user-1",
      centralSessionId: "central-session-1",
      reason: "sso_logout",
    });

    expect(first).toEqual({ alreadyProcessed: false, revokedCount: 1 });
    expect(second).toEqual({ alreadyProcessed: true, revokedCount: 0 });
    expect(processedEvents).toEqual(new Set(["app-a:event-1"]));
  });

  it("handles concurrent duplicate events as a successful replay", async () => {
    const { service, processedEvents } = createRepository();
    const event = {
      eventId: "event-concurrent",
      eventType: "SessionRevoked",
      externalUserId: "user-1",
      centralSessionId: "central-session-1",
      reason: "sso_logout",
    };

    const results = await Promise.all([
      service.processInternalLogout(event),
      service.processInternalLogout(event),
    ]);

    expect(results.filter((result) => result.alreadyProcessed)).toHaveLength(1);
    expect(processedEvents).toEqual(new Set(["app-a:event-concurrent"]));
  });

  it("rolls back local login if its activity audit cannot be written", async () => {
    const { service, repository, sessions, profiles } = createRepository();
    repository.createActivityLog = async () => {
      throw new Error("audit failed");
    };

    await expect(
      service.createSessionFromUserInfo({
        sub: "user-1",
        name: "Student User",
        email: "student@example.com",
        groups: ["app-a-users"],
        centralSessionId: "central-session-1",
      }),
    ).rejects.toThrow("audit failed");
    expect(sessions.size).toBe(0);
    expect(profiles.size).toBe(0);
  });

  it("persists and reports an expired local session", async () => {
    const { service, sessions } = createRepository();
    await service.createSessionFromUserInfo({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-a-users"],
      centralSessionId: "central-session-1",
    });
    const storedSession = [...sessions.values()][0]!;
    storedSession.expiresAt = new Date("2026-08-09T09:59:00.000Z");

    const view = await service.getCurrentSession("raw-local-session-token");

    expect(view).toMatchObject({ status: "expired", session: { status: "expired" } });
    expect(storedSession.status).toBe("expired");
  });

  it("revokes every user session when password changes", async () => {
    const { service, sessions } = createRepository();
    sessions.set("session-token-1", {
      id: "local-session-1",
      appKey: "app-a",
      sessionTokenHash: "session-token-1",
      externalUserId: "user-1",
      centralSessionId: "central-session-1",
      status: "active",
      createdAt: new Date("2026-08-09T09:00:00.000Z"),
      expiresAt: new Date("2026-08-09T11:00:00.000Z"),
      revokedAt: null,
    });
    sessions.set("session-token-2", {
      id: "local-session-2",
      appKey: "app-a",
      sessionTokenHash: "session-token-2",
      externalUserId: "user-1",
      centralSessionId: "central-session-2",
      status: "active",
      createdAt: new Date("2026-08-09T09:30:00.000Z"),
      expiresAt: new Date("2026-08-09T11:30:00.000Z"),
      revokedAt: null,
    });

    const result = await service.processInternalLogout({
      eventId: "event-password-1",
      eventType: "PasswordChanged",
      externalUserId: "user-1",
      centralSessionId: null,
      reason: "password_changed",
    });

    expect(result).toEqual({ alreadyProcessed: false, revokedCount: 2 });
    expect([...sessions.values()].map((session) => session.status)).toEqual([
      "revoked",
      "revoked",
    ]);
  });

  it("revokes this application's user sessions when access policy changes", async () => {
    const { service, sessions } = createRepository("app-a");
    sessions.set("app-a-session", {
      id: "local-session-1",
      appKey: "app-a",
      sessionTokenHash: "app-a-session",
      externalUserId: "user-1",
      centralSessionId: "central-session-1",
      status: "active",
      createdAt: new Date("2026-08-09T09:00:00.000Z"),
      expiresAt: new Date("2026-08-09T11:00:00.000Z"),
      revokedAt: null,
    });
    sessions.set("other-user-session", {
      id: "local-session-2",
      appKey: "app-a",
      sessionTokenHash: "other-user-session",
      externalUserId: "user-2",
      centralSessionId: "central-session-2",
      status: "active",
      createdAt: new Date("2026-08-09T09:00:00.000Z"),
      expiresAt: new Date("2026-08-09T11:00:00.000Z"),
      revokedAt: null,
    });
    sessions.set("other-app-session", {
      id: "local-session-3",
      appKey: "app-b",
      sessionTokenHash: "other-app-session",
      externalUserId: "user-1",
      centralSessionId: "central-session-1",
      status: "active",
      createdAt: new Date("2026-08-09T09:00:00.000Z"),
      expiresAt: new Date("2026-08-09T11:00:00.000Z"),
      revokedAt: null,
    });

    const result = await service.processInternalLogout({
      eventId: "event-policy-1",
      eventType: "AccessPolicyChanged",
      externalUserId: "user-1",
      centralSessionId: null,
      reason: "group_membership_removed",
    });

    expect(result).toEqual({ alreadyProcessed: false, revokedCount: 1 });
    expect(sessions.get("app-a-session")?.status).toBe("revoked");
    expect(sessions.get("other-user-session")?.status).toBe("active");
    expect(sessions.get("other-app-session")?.status).toBe("active");
  });
});
