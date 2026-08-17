import { describe, expect, it } from "vitest";
import {
  createLocalSessionService,
  type LocalSessionRecord,
  type LocalSessionRepository,
} from "@sso/relying-app-server";

function createRepository() {
  const sessions = new Map<string, LocalSessionRecord>();
  const processedEvents = new Set<string>();
  const profiles = new Map<string, { name: string; email: string; groups: string[] }>();

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
      const profile = profiles.get(`${input.appKey}:${session?.externalUserId}`);
      return session && profile && session.appKey === input.appKey
        ? { ...session, profile: { ...profile, appKey: input.appKey, externalUserId: session.externalUserId, syncedAt: new Date("2026-08-09T10:00:00.000Z") } }
        : null;
    },
    revokeSessionByHash: async (input) => {
      const session = sessions.get(input.sessionTokenHash);
      if (!session || session.appKey !== input.appKey) return null;
      session.status = "revoked";
      session.revokedAt = new Date("2026-08-09T10:05:00.000Z");
      return session;
    },
    upsertProfile: async (input) => {
      profiles.set(`${input.appKey}:${input.externalUserId}`, {
        name: input.name,
        email: input.email,
        groups: input.groups,
      });
      return input;
    },
    createActivityLog: async () => {},
    listActivityLogs: async () => [],
    findProcessedEvent: async (input) =>
      processedEvents.has(`${input.appKey}:${input.eventId}`)
        ? { appKey: input.appKey, eventId: input.eventId }
        : null,
    insertProcessedEvent: async (input) => {
      processedEvents.add(`${input.appKey}:${input.eventId}`);
    },
    listProcessedEvents: async () => [],
    revokeSessionsForLogoutEvent: async (input) => {
      let count = 0;
      for (const session of sessions.values()) {
        if (
          session.appKey === input.appKey &&
          session.centralSessionId === input.centralSessionId &&
          session.externalUserId === input.externalUserId &&
          session.status === "active"
        ) {
          session.status = "revoked";
          count += 1;
        }
      }
      return count;
    },
  };

  return { repository, sessions, processedEvents };
}

function createService(repository: LocalSessionRepository) {
  return createLocalSessionService({
    appKey: "app-b",
    repository,
    generateToken: () => "raw-local-session-token",
    now: () => new Date("2026-08-09T10:00:00.000Z"),
    sessionTtlMinutes: 60,
  });
}

describe("App B local session service", () => {
  it("creates local session after userinfo is available", async () => {
    const { repository, sessions } = createRepository();
    const service = createService(repository);

    await service.createSessionFromUserInfo({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-b-users"],
      centralSessionId: "central-session-1",
    });

    expect([...sessions.values()][0]).toMatchObject({
      appKey: "app-b",
      externalUserId: "user-1",
      centralSessionId: "central-session-1",
    });
  });

  it("returns active session from valid cookie", async () => {
    const { repository } = createRepository();
    const service = createService(repository);
    await service.createSessionFromUserInfo({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-b-users"],
      centralSessionId: "central-session-1",
    });

    await expect(
      service.getCurrentSession("raw-local-session-token"),
    ).resolves.toMatchObject({
      status: "authenticated",
      user: { groups: ["app-b-users"] },
    });
  });

  it("revokes only matching app local session on local logout", async () => {
    const { repository, sessions } = createRepository();
    const service = createService(repository);
    await service.createSessionFromUserInfo({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-b-users"],
      centralSessionId: "central-session-1",
    });

    await service.logout("raw-local-session-token");

    expect([...sessions.values()][0]?.status).toBe("revoked");
  });

  it("processes internal logout idempotently by event id", async () => {
    const { repository, processedEvents } = createRepository();
    const service = createService(repository);

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

    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(true);
    expect(processedEvents).toEqual(new Set(["app-b:event-1"]));
  });
});
