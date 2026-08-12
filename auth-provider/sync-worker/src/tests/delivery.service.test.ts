import type { RevocationEventPayload } from "@sso/shared";
import { describe, expect, it } from "vitest";
import type {
  DeliveryRepository,
  EventDeliveryJob,
  InternalLogoutClient,
} from "../delivery.service.js";
import { createDeliveryService } from "../delivery.service.js";

const payload: RevocationEventPayload = {
  eventId: "event-1",
  eventType: "SessionRevoked",
  userId: "user-1",
  centralSessionId: "central-session-1",
  applicationId: null,
  reason: "sso_logout",
  occurredAt: "2026-08-09T10:00:00.000Z",
  metadata: {},
};

function createDelivery(
  overrides: Partial<EventDeliveryJob> = {},
): EventDeliveryJob {
  return {
    id: overrides.id ?? "delivery-1",
    eventId: overrides.eventId ?? "event-1",
    applicationId: overrides.applicationId ?? "app-1",
    status: overrides.status ?? "pending",
    attemptCount: overrides.attemptCount ?? 0,
    application: overrides.application ?? {
      id: "app-1",
      name: "App A",
      logoutNotificationUrl: "http://localhost:4101/internal/logout",
    },
  };
}

function createRepository(deliveries: EventDeliveryJob[]) {
  const succeeded: string[] = [];
  const retrying: Array<{ id: string; attemptCount: number; nextRetryAt: Date }> =
    [];
  const failed: Array<{ id: string; attemptCount: number }> = [];
  const processedEvents: string[] = [];

  const repository: DeliveryRepository = {
    listDeliveriesForEvent: async () => deliveries,
    markDeliverySucceeded: async (id) => {
      succeeded.push(id);
      const delivery = deliveries.find((item) => item.id === id);
      if (delivery) delivery.status = "succeeded";
    },
    markDeliveryRetrying: async (input) => {
      retrying.push({
        id: input.id,
        attemptCount: input.attemptCount,
        nextRetryAt: input.nextRetryAt,
      });
      const delivery = deliveries.find((item) => item.id === input.id);
      if (delivery) {
        delivery.status = "retrying";
        delivery.attemptCount = input.attemptCount;
      }
    },
    markDeliveryFailed: async (input) => {
      failed.push({ id: input.id, attemptCount: input.attemptCount });
      const delivery = deliveries.find((item) => item.id === input.id);
      if (delivery) {
        delivery.status = "failed";
        delivery.attemptCount = input.attemptCount;
      }
    },
    markEventProcessed: async (eventId) => {
      processedEvents.push(eventId);
    },
  };

  return { repository, succeeded, retrying, failed, processedEvents };
}

function createClient(failingUrls: string[] = []) {
  const calls: Array<{ url: string; payload: RevocationEventPayload }> = [];
  const client: InternalLogoutClient = {
    sendInternalLogout: async (url, sentPayload) => {
      calls.push({ url, payload: sentPayload });
      if (failingUrls.includes(url)) {
        throw new Error("app unavailable");
      }
    },
  };

  return { client, calls };
}

describe("delivery service", () => {
  it("calls each application internal logout independently", async () => {
    const deliveries = [
      createDelivery(),
      createDelivery({
        id: "delivery-2",
        applicationId: "app-2",
        application: {
          id: "app-2",
          name: "App B",
          logoutNotificationUrl: "http://localhost:4102/internal/logout",
        },
      }),
    ];
    const { repository, succeeded } = createRepository(deliveries);
    const { client, calls } = createClient();
    const service = createDeliveryService({
      repository,
      client,
      internalSecret: "internal-secret",
      maxAttempts: 3,
      retryDelayMs: 1000,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });

    await service.processRevocationEvent(payload);

    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:4101/internal/logout",
      "http://localhost:4102/internal/logout",
    ]);
    expect(succeeded).toEqual(["delivery-1", "delivery-2"]);
  });

  it("marks one delivery succeeded even when another fails", async () => {
    const deliveries = [
      createDelivery(),
      createDelivery({
        id: "delivery-2",
        applicationId: "app-2",
        application: {
          id: "app-2",
          name: "App B",
          logoutNotificationUrl: "http://localhost:4102/internal/logout",
        },
      }),
    ];
    const { repository, succeeded, retrying } = createRepository(deliveries);
    const { client } = createClient(["http://localhost:4102/internal/logout"]);
    const service = createDeliveryService({
      repository,
      client,
      internalSecret: "internal-secret",
      maxAttempts: 3,
      retryDelayMs: 1000,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });

    await service.processRevocationEvent(payload);

    expect(succeeded).toEqual(["delivery-1"]);
    expect(retrying).toEqual([
      {
        id: "delivery-2",
        attemptCount: 1,
        nextRetryAt: new Date("2026-08-09T10:00:01.000Z"),
      },
    ]);
  });

  it("moves delivery to failed after max attempts", async () => {
    const deliveries = [createDelivery({ attemptCount: 2 })];
    const { repository, failed } = createRepository(deliveries);
    const { client } = createClient(["http://localhost:4101/internal/logout"]);
    const service = createDeliveryService({
      repository,
      client,
      internalSecret: "internal-secret",
      maxAttempts: 3,
      retryDelayMs: 1000,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });

    await service.processRevocationEvent(payload);

    expect(failed).toEqual([{ id: "delivery-1", attemptCount: 3 }]);
  });

  it("does not duplicate app processing when event already succeeded", async () => {
    const deliveries = [createDelivery({ status: "succeeded" })];
    const { repository, succeeded } = createRepository(deliveries);
    const { client, calls } = createClient();
    const service = createDeliveryService({
      repository,
      client,
      internalSecret: "internal-secret",
      maxAttempts: 3,
      retryDelayMs: 1000,
      now: () => new Date("2026-08-09T10:00:00.000Z"),
    });

    await service.processRevocationEvent(payload);

    expect(calls).toEqual([]);
    expect(succeeded).toEqual([]);
  });
});
