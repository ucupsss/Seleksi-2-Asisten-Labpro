import type { RevocationEventPayload } from "@sso/shared";
import type {
  PrismaClient,
} from "../../../node_modules/.prisma/auth-client/index.js";

export type DeliveryStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "retrying"
  | "failed";

export interface EventDeliveryJob {
  id: string;
  eventId: string;
  applicationId: string;
  status: DeliveryStatus;
  attemptCount: number;
  application: {
    id: string;
    name: string;
    logoutNotificationUrl: string;
  };
}

export interface DeliveryRepository {
  listDeliveriesForEvent(eventId: string): Promise<EventDeliveryJob[]>;
  markDeliverySucceeded(
    id: string,
    processedAt: Date,
    attemptCount: number,
  ): Promise<void>;
  markDeliveryRetrying(input: {
    id: string;
    attemptCount: number;
    lastAttemptAt: Date;
    nextRetryAt: Date;
    lastError: string;
  }): Promise<void>;
  markDeliveryFailed(input: {
    id: string;
    attemptCount: number;
    lastAttemptAt: Date;
    lastError: string;
  }): Promise<void>;
  markEventProcessed(eventId: string, processedAt: Date): Promise<void>;
  markEventDeadLettered(eventId: string): Promise<void>;
}

export interface InternalLogoutClient {
  sendInternalLogout(
    url: string,
    payload: RevocationEventPayload,
    internalSecret: string,
  ): Promise<void>;
}

export type DeliveryOutcome = "processed" | "retry" | "dead_letter";

export interface DeliveryService {
  processRevocationEvent(
    payload: RevocationEventPayload,
  ): Promise<DeliveryOutcome>;
}

export interface DeliveryServiceDependencies {
  repository: DeliveryRepository;
  client: InternalLogoutClient;
  internalSecret: string;
  maxAttempts: number;
  retryDelayMs: number;
  now?: () => Date;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown delivery error";
}

function shouldProcess(delivery: EventDeliveryJob) {
  return delivery.status === "pending" || delivery.status === "retrying";
}

export function createDeliveryService(
  deps: DeliveryServiceDependencies,
): DeliveryService {
  const now = deps.now ?? (() => new Date());

  return {
    async processRevocationEvent(payload) {
      const deliveries = await deps.repository.listDeliveriesForEvent(
        payload.eventId,
      );

      for (const delivery of deliveries) {
        if (!shouldProcess(delivery)) {
          continue;
        }

        const attemptedAt = now();
        const nextAttemptCount = delivery.attemptCount + 1;

        try {
          await deps.client.sendInternalLogout(
            delivery.application.logoutNotificationUrl,
            payload,
            deps.internalSecret,
          );
          await deps.repository.markDeliverySucceeded(
            delivery.id,
            attemptedAt,
            nextAttemptCount,
          );
        } catch (error) {
          if (nextAttemptCount >= deps.maxAttempts) {
            await deps.repository.markDeliveryFailed({
              id: delivery.id,
              attemptCount: nextAttemptCount,
              lastAttemptAt: attemptedAt,
              lastError: errorMessage(error),
            });
            continue;
          }

          await deps.repository.markDeliveryRetrying({
            id: delivery.id,
            attemptCount: nextAttemptCount,
            lastAttemptAt: attemptedAt,
            nextRetryAt: new Date(attemptedAt.getTime() + deps.retryDelayMs),
            lastError: errorMessage(error),
          });
        }
      }

      const remainingDeliveries =
        await deps.repository.listDeliveriesForEvent(payload.eventId);
      if (
        remainingDeliveries.some(
          (delivery) =>
            delivery.status !== "succeeded" && delivery.status !== "failed",
        )
      ) {
        return "retry";
      }

      if (
        remainingDeliveries.some((delivery) => delivery.status === "failed")
      ) {
        await deps.repository.markEventDeadLettered(payload.eventId);
        return "dead_letter";
      }

      await deps.repository.markEventProcessed(payload.eventId, now());
      return "processed";
    },
  };
}

export function createFetchInternalLogoutClient(): InternalLogoutClient {
  return {
    async sendInternalLogout(url, payload, internalSecret) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({
          eventId: payload.eventId,
          eventType: payload.eventType,
          userId: payload.userId,
          centralSessionId: payload.centralSessionId,
          applicationId: payload.applicationId,
          reason: payload.reason,
        }),
      });

      if (!response.ok) {
        throw new Error(`Internal logout failed with HTTP ${response.status}`);
      }
    },
  };
}

export function createPrismaDeliveryRepository(
  prisma: PrismaClient,
): DeliveryRepository {
  return {
    async listDeliveriesForEvent(eventId) {
      return prisma.eventDelivery.findMany({
        where: { eventId },
        include: {
          application: {
            select: {
              id: true,
              name: true,
              logoutNotificationUrl: true,
            },
          },
        },
      });
    },

    async markDeliverySucceeded(id, processedAt, attemptCount) {
      await prisma.eventDelivery.update({
        where: { id },
        data: {
          status: "succeeded",
          attemptCount,
          processedAt,
          lastAttemptAt: processedAt,
          nextRetryAt: null,
          lastError: null,
        },
      });
    },

    async markDeliveryRetrying(input) {
      await prisma.eventDelivery.update({
        where: { id: input.id },
        data: {
          status: "retrying",
          attemptCount: input.attemptCount,
          lastAttemptAt: input.lastAttemptAt,
          nextRetryAt: input.nextRetryAt,
          lastError: input.lastError,
        },
      });
    },

    async markDeliveryFailed(input) {
      await prisma.eventDelivery.update({
        where: { id: input.id },
        data: {
          status: "failed",
          attemptCount: input.attemptCount,
          lastAttemptAt: input.lastAttemptAt,
          nextRetryAt: null,
          lastError: input.lastError,
        },
      });
    },

    async markEventProcessed(eventId, _processedAt) {
      await prisma.event.update({
        where: { id: eventId },
        data: {
          status: "processed",
        },
      });
    },

    async markEventDeadLettered(eventId) {
      await prisma.event.update({
        where: { id: eventId },
        data: { status: "dead_lettered" },
      });
    },
  };
}
