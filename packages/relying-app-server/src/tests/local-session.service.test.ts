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
  const activityLogs: Array<{ appKey: string; eventType: string }> = [];

  const repository: LocalSessionRepository = {
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
      activityLogs.push({ appKey: input.appKey, eventType: input.eventType });
    },
    findProcessedEvent: async (input) =>
      processedEvents.has(`${input.appKey}:${input.eventId}`)
        ? { eventId: input.eventId, appKey: input.appKey }
        : null,
    insertProcessedEvent: async (input) => {
      processedEvents.add(`${input.appKey}:${input.eventId}`);
    },
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

  return { service, sessions, profiles, processedEvents, activityLogs };
}

describe("local session service", () => {
  it("creates local session after userinfo is available", async () => {
    const { service, sessions, profiles, activityLogs } = createRepository();

    const result = await service.createSessionFromUserInfo({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-a-users"],
      centralSessionId: "central-session-1",
    });

    expect(result.sessionToken).toBe("raw-local-session-token");
    expect(result.session.expiresAt.toISOString()).toBe(
      "2026-08-09T11:00:00.000Z",
    );
    expect(sessions.size).toBe(1);
    expect(profiles.get("app-a:user-1")).toMatchObject({
      name: "Student User",
      groups: ["app-a-users"],
    });
    expect(activityLogs).toContainEqual({
      appKey: "app-a",
      eventType: "local_login_success",
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
});
