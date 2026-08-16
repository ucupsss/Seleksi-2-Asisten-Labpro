import type { RevocationEventPayload } from "@sso/shared";
import type { PrismaClient } from "../../../node_modules/.prisma/auth-client/index.js";

export interface OutboxEvent {
  id: string;
  payload: unknown;
}

export interface OutboxRepository {
  listPendingEvents(): Promise<OutboxEvent[]>;
  markEventPublished(id: string, publishedAt: Date): Promise<void>;
}

export interface OutboxPublisher {
  publishRevocation(payload: RevocationEventPayload): Promise<void>;
}

function isRevocationPayload(value: unknown): value is RevocationEventPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "eventId" in value &&
    typeof value.eventId === "string" &&
    "eventType" in value &&
    typeof value.eventType === "string"
  );
}

export function createOutboxService(deps: {
  repository: OutboxRepository;
  publisher: OutboxPublisher;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  return {
    async publishPendingEvents() {
      const events = await deps.repository.listPendingEvents();
      for (const event of events) {
        if (!isRevocationPayload(event.payload)) continue;

        await deps.publisher.publishRevocation(event.payload);
        await deps.repository.markEventPublished(event.id, now());
      }
    },
  };
}

export function createPrismaOutboxRepository(
  prisma: Pick<PrismaClient, "event">,
): OutboxRepository {
  return {
    async listPendingEvents() {
      return prisma.event.findMany({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
        select: { id: true, payload: true },
      });
    },

    async markEventPublished(id, publishedAt) {
      await prisma.event.updateMany({
        where: { id, status: "pending" },
        data: {
          status: "published",
          publishedAt,
        },
      });
    },
  };
}
