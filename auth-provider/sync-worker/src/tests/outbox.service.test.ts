import type { RevocationEventPayload } from "@sso/shared";
import { describe, expect, it } from "vitest";
import {
  createOutboxService,
  type OutboxEvent,
  type OutboxRepository,
} from "../outbox.service.js";

const payload: RevocationEventPayload = {
  eventId: "event-1",
  eventType: "SessionRevoked",
  userId: "user-1",
  centralSessionId: "session-1",
  applicationId: null,
  reason: "sso_logout",
  occurredAt: "2026-08-16T10:00:00.000Z",
  metadata: {},
};

function createRepository(events: OutboxEvent[]) {
  const published: string[] = [];
  const repository: OutboxRepository = {
    listPendingEvents: async () => events,
    markEventPublished: async (id) => {
      published.push(id);
    },
  };

  return { repository, published };
}

describe("outbox service", () => {
  it("marks an event published only after the broker accepts it", async () => {
    const { repository, published } = createRepository([
      { id: "event-1", payload },
    ]);
    const calls: string[] = [];
    const service = createOutboxService({
      repository,
      publisher: {
        publishRevocation: async (sentPayload) => {
          calls.push(sentPayload.eventId);
        },
      },
      now: () => new Date("2026-08-16T10:00:01.000Z"),
    });

    await service.publishPendingEvents();

    expect(calls).toEqual(["event-1"]);
    expect(published).toEqual(["event-1"]);
  });

  it("leaves an event pending when publishing fails", async () => {
    const { repository, published } = createRepository([
      { id: "event-1", payload },
    ]);
    const service = createOutboxService({
      repository,
      publisher: {
        publishRevocation: async () => {
          throw new Error("broker unavailable");
        },
      },
    });

    await expect(service.publishPendingEvents()).rejects.toThrow(
      "broker unavailable",
    );
    expect(published).toEqual([]);
  });
});
