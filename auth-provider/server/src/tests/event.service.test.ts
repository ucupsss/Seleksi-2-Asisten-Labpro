import { describe, expect, it } from "vitest";
import type {
  EventRecord,
  EventRepository,
  EventServiceApplication,
  EventServiceSsoSession,
} from "../services/event.service.js";
import { createEventService } from "../services/event.service.js";

const activeSession: EventServiceSsoSession = {
  id: "central-session-1",
  userId: "user-1",
  sessionTokenHash: "hashed-session-token",
  status: "active",
  revokedAt: null,
};

const applications: EventServiceApplication[] = [
  {
    id: "app-1",
    name: "App A",
    logoutNotificationUrl: "http://localhost:4101/internal/logout",
  },
  {
    id: "app-2",
    name: "App B",
    logoutNotificationUrl: "http://localhost:4102/internal/logout",
  },
];

function createRepository(overrides: Partial<EventRepository> = {}) {
  const revokedSessions: Array<{ id: string; reason: string }> = [];
  const revokedTokens: Array<{ sessionId: string }> = [];
  const events: EventRecord[] = [];
  const deliveries: Array<{ eventId: string; applicationId: string }> = [];
  const publishedEvents: Array<{ id: string; publishedAt: Date }> = [];
  const publishedPayloads: unknown[] = [];

  const repository: EventRepository = {
    withTransaction: async (work) => work(repository),
    findSsoSessionByHash: async (sessionTokenHash) =>
      sessionTokenHash === activeSession.sessionTokenHash ? activeSession : null,
    revokeSsoSession: async (id, reason) => {
      revokedSessions.push({ id, reason });
      return { ...activeSession, status: "revoked", revokedAt: new Date() };
    },
    revokeAccessTokensBySession: async (sessionId) => {
      revokedTokens.push({ sessionId });
      return 2;
    },
    listActiveApplications: async () => applications,
    createEvent: async (input) => {
      const event = {
        id: input.id,
        eventType: input.eventType,
        userId: input.userId,
        centralSessionId: input.centralSessionId,
        applicationId: input.applicationId,
        payload: input.payload,
        status: "pending",
        createdAt: new Date("2026-08-09T10:00:00.000Z"),
      };
      events.push(event);
      return event;
    },
    createEventDelivery: async (input) => {
      deliveries.push(input);
    },
    listPendingEvents: async () => events,
    markEventPublished: async (id, publishedAt) => {
      publishedEvents.push({ id, publishedAt });
    },
    ...overrides,
  };

  const publisher = {
    publishRevocation: async (payload: unknown) => {
      publishedPayloads.push(payload);
    },
  };

  return {
    repository,
    publisher,
    revokedSessions,
    revokedTokens,
    events,
    deliveries,
    publishedEvents,
    publishedPayloads,
  };
}

function createService(repository: EventRepository, publisher?: { publishRevocation(payload: unknown): Promise<void> }) {
  return createEventService({
    repository,
    publisher,
    generateEventId: () => "event-1",
    now: () => new Date("2026-08-09T10:00:00.000Z"),
  });
}

describe("event service", () => {
  it("revokes central session and creates SessionRevoked event in one transaction", async () => {
    const { repository, revokedSessions, revokedTokens, events } =
      createRepository();
    const service = createService(repository);

    const result = await service.createSessionRevokedEvent({
      sessionTokenHash: "hashed-session-token",
      reason: "sso_logout",
    });

    expect(result?.event.id).toBe("event-1");
    expect(revokedSessions).toEqual([
      { id: "central-session-1", reason: "sso_logout" },
    ]);
    expect(revokedTokens).toEqual([{ sessionId: "central-session-1" }]);
    expect(events[0]?.payload).toEqual({
      eventId: "event-1",
      eventType: "SessionRevoked",
      userId: "user-1",
      centralSessionId: "central-session-1",
      applicationId: null,
      reason: "sso_logout",
      occurredAt: "2026-08-09T10:00:00.000Z",
      metadata: { revokedAccessTokenCount: 2 },
    });
  });

  it("creates separate event deliveries for App A and App B", async () => {
    const { repository, deliveries } = createRepository();
    const service = createService(repository);

    await service.createSessionRevokedEvent({
      sessionTokenHash: "hashed-session-token",
      reason: "sso_logout",
    });

    expect(deliveries).toEqual([
      { eventId: "event-1", applicationId: "app-1" },
      { eventId: "event-1", applicationId: "app-2" },
    ]);
  });

  it("publishes pending events and marks them published after broker accepts them", async () => {
    const {
      repository,
      publisher,
      publishedEvents,
      publishedPayloads,
    } = createRepository();
    const service = createService(repository, publisher);
    await service.createSessionRevokedEvent({
      sessionTokenHash: "hashed-session-token",
      reason: "sso_logout",
    });

    await service.publishPendingEvents();

    expect(publishedPayloads).toHaveLength(1);
    expect(publishedEvents).toEqual([
      {
        id: "event-1",
        publishedAt: new Date("2026-08-09T10:00:00.000Z"),
      },
    ]);
  });
});
