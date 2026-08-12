import { randomUUID } from "node:crypto";
import type { RevocationEventPayload } from "@sso/shared";
import type {
  Prisma,
  PrismaClient,
} from "../../../../node_modules/.prisma/auth-client/index.js";

export interface EventServiceSsoSession {
  id: string;
  userId: string;
  sessionTokenHash: string;
  status: string;
  revokedAt: Date | null;
}

export interface EventServiceApplication {
  id: string;
  name: string;
  logoutNotificationUrl: string;
}

export interface EventRecord {
  id: string;
  eventType: string;
  userId: string;
  centralSessionId: string | null;
  applicationId: string | null;
  payload: unknown;
  status: string;
  createdAt: Date;
}

export interface EventRepository {
  withTransaction<T>(
    work: (repository: EventRepository) => Promise<T>,
  ): Promise<T>;
  findSsoSessionByHash(
    sessionTokenHash: string,
  ): Promise<EventServiceSsoSession | null>;
  revokeSsoSession(
    id: string,
    reason: string,
    revokedAt: Date,
  ): Promise<EventServiceSsoSession>;
  revokeAccessTokensBySession(sessionId: string, revokedAt: Date): Promise<number>;
  listActiveApplications(): Promise<EventServiceApplication[]>;
  createEvent(input: {
    id: string;
    eventType: string;
    userId: string;
    centralSessionId: string | null;
    applicationId: string | null;
    payload: RevocationEventPayload;
  }): Promise<EventRecord>;
  createEventDelivery(input: {
    eventId: string;
    applicationId: string;
  }): Promise<void>;
  listPendingEvents(): Promise<EventRecord[]>;
  markEventPublished(id: string, publishedAt: Date): Promise<void>;
}

export interface EventPublisher {
  publishRevocation(payload: RevocationEventPayload): Promise<void>;
}

export interface CreateSessionRevokedEventInput {
  sessionTokenHash: string;
  reason: string;
}

export interface SessionRevokedEventResult {
  event: EventRecord;
  revokedSession: EventServiceSsoSession;
  deliveryCount: number;
}

export interface EventService {
  createSessionRevokedEvent(
    input: CreateSessionRevokedEventInput,
  ): Promise<SessionRevokedEventResult | null>;
  publishPendingEvents(): Promise<void>;
}

export interface EventServiceDependencies {
  repository: EventRepository;
  publisher?: EventPublisher;
  generateEventId?: () => string;
  now?: () => Date;
}

function isRevocationPayload(payload: unknown): payload is RevocationEventPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "eventId" in payload &&
    "eventType" in payload
  );
}

export function createEventService(deps: EventServiceDependencies): EventService {
  const generateEventId = deps.generateEventId ?? (() => randomUUID());
  const now = deps.now ?? (() => new Date());

  return {
    async createSessionRevokedEvent(input) {
      return deps.repository.withTransaction(async (repository) => {
        const session = await repository.findSsoSessionByHash(
          input.sessionTokenHash,
        );

        if (!session || session.revokedAt || session.status !== "active") {
          return null;
        }

        const occurredAt = now();
        const revokedSession = await repository.revokeSsoSession(
          session.id,
          input.reason,
          occurredAt,
        );
        const revokedAccessTokenCount =
          await repository.revokeAccessTokensBySession(session.id, occurredAt);
        const applications = await repository.listActiveApplications();
        const eventId = generateEventId();
        const payload: RevocationEventPayload = {
          eventId,
          eventType: "SessionRevoked",
          userId: session.userId,
          centralSessionId: session.id,
          applicationId: null,
          reason: input.reason,
          occurredAt: occurredAt.toISOString(),
          metadata: { revokedAccessTokenCount },
        };
        const event = await repository.createEvent({
          id: eventId,
          eventType: "SessionRevoked",
          userId: session.userId,
          centralSessionId: session.id,
          applicationId: null,
          payload,
        });

        await Promise.all(
          applications.map((application) =>
            repository.createEventDelivery({
              eventId: event.id,
              applicationId: application.id,
            }),
          ),
        );

        return {
          event,
          revokedSession,
          deliveryCount: applications.length,
        };
      });
    },

    async publishPendingEvents() {
      if (!deps.publisher) {
        return;
      }

      const events = await deps.repository.listPendingEvents();

      for (const event of events) {
        if (!isRevocationPayload(event.payload)) {
          continue;
        }

        await deps.publisher.publishRevocation(event.payload);
        await deps.repository.markEventPublished(event.id, now());
      }
    },
  };
}

type EventPrismaClient = Pick<
  PrismaClient,
  | "ssoSession"
  | "accessToken"
  | "application"
  | "event"
  | "eventDelivery"
>;

type EventPrismaRootClient = EventPrismaClient & Pick<PrismaClient, "$transaction">;

export function createPrismaEventRepository(
  prisma: EventPrismaClient | EventPrismaRootClient,
): EventRepository {
  const repository: EventRepository = {
    async withTransaction(work) {
      if (!("$transaction" in prisma)) {
        return work(repository);
      }

      return prisma.$transaction(async (tx) =>
        work(createPrismaEventRepository(tx as unknown as EventPrismaClient)),
      );
    },

    async findSsoSessionByHash(sessionTokenHash) {
      return prisma.ssoSession.findUnique({
        where: { sessionTokenHash },
        select: {
          id: true,
          userId: true,
          sessionTokenHash: true,
          status: true,
          revokedAt: true,
        },
      });
    },

    async revokeSsoSession(id, reason, revokedAt) {
      return prisma.ssoSession.update({
        where: { id },
        data: {
          status: "revoked",
          revokedAt,
          revokeReason: reason,
        },
        select: {
          id: true,
          userId: true,
          sessionTokenHash: true,
          status: true,
          revokedAt: true,
        },
      });
    },

    async revokeAccessTokensBySession(sessionId, revokedAt) {
      const result = await prisma.accessToken.updateMany({
        where: {
          ssoSessionId: sessionId,
          status: "active",
          revokedAt: null,
        },
        data: {
          status: "revoked",
          revokedAt,
        },
      });
      return result.count;
    },

    async listActiveApplications() {
      return prisma.application.findMany({
        where: { status: "active" },
        select: {
          id: true,
          name: true,
          logoutNotificationUrl: true,
        },
      });
    },

    async createEvent(input) {
      return prisma.event.create({
        data: {
          id: input.id,
          eventType: input.eventType,
          userId: input.userId,
          centralSessionId: input.centralSessionId,
          applicationId: input.applicationId,
          payload: input.payload as unknown as Prisma.InputJsonValue,
        },
      });
    },

    async createEventDelivery(input) {
      await prisma.eventDelivery.create({
        data: input,
      });
    },

    async listPendingEvents() {
      return prisma.event.findMany({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
      });
    },

    async markEventPublished(id, publishedAt) {
      await prisma.event.update({
        where: { id },
        data: {
          status: "published",
          publishedAt,
        },
      });
    },
  };

  return repository;
}
