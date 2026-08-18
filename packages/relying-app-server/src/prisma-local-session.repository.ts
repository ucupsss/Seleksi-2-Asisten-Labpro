import type {
  Prisma,
  PrismaClient,
} from "../../../node_modules/.prisma/local-client/index.js";
import type {
  AuthenticatedLocalSessionRecord,
  LocalSessionRepository,
  ProfileRecord,
} from "./local-session.service.js";

function groupsFromJson(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((group): group is string => typeof group === "string")
    : [];
}

function toProfileRecord(profile: {
  appKey: string;
  externalUserId: string;
  name: string;
  email: string;
  groups: Prisma.JsonValue | null;
  syncedAt: Date;
}): ProfileRecord {
  return {
    appKey: profile.appKey,
    externalUserId: profile.externalUserId,
    name: profile.name,
    email: profile.email,
    groups: groupsFromJson(profile.groups),
    syncedAt: profile.syncedAt,
  };
}

export function createPrismaLocalSessionRepository(
  prisma: PrismaClient | Prisma.TransactionClient,
): LocalSessionRepository {
  const repository: LocalSessionRepository = {
    async withTransaction(work) {
      if (!("$transaction" in prisma)) {
        return work(repository);
      }
      return prisma.$transaction((transaction) =>
        work(createPrismaLocalSessionRepository(transaction)),
      );
    },
    async createLocalSession(input) {
      return prisma.localSession.create({
        data: input,
      });
    },

    async findSessionByHash(input) {
      return prisma.localSession.findFirst({
        where: {
          appKey: input.appKey,
          sessionTokenHash: input.sessionTokenHash,
        },
      });
    },

    async markSessionExpired(input) {
      await prisma.localSession.updateMany({
        where: {
          appKey: input.appKey,
          sessionTokenHash: input.sessionTokenHash,
          status: "active",
          revokedAt: null,
        },
        data: { status: "expired" },
      });
    },

    async findActiveSessionByHash(input) {
      const session = await prisma.localSession.findFirst({
        where: {
          appKey: input.appKey,
          sessionTokenHash: input.sessionTokenHash,
          status: "active",
          revokedAt: null,
        },
      });

      if (!session) {
        return null;
      }

      const profile = await prisma.profileCache.findUnique({
        where: {
          appKey_externalUserId: {
            appKey: session.appKey,
            externalUserId: session.externalUserId,
          },
        },
      });

      if (!profile) {
        return null;
      }

      return {
        ...session,
        profile: toProfileRecord(profile),
      } satisfies AuthenticatedLocalSessionRecord;
    },

    async revokeSessionByHash(input) {
      const session = await prisma.localSession.findFirst({
        where: {
          appKey: input.appKey,
          sessionTokenHash: input.sessionTokenHash,
          status: "active",
        },
      });

      if (!session) {
        return null;
      }

      return prisma.localSession.update({
        where: { id: session.id },
        data: {
          status: "revoked",
          revokedAt: new Date(),
          revokeReason: input.reason,
        },
      });
    },

    async upsertProfile(input) {
      const profile = await prisma.profileCache.upsert({
        where: {
          appKey_externalUserId: {
            appKey: input.appKey,
            externalUserId: input.externalUserId,
          },
        },
        create: {
          appKey: input.appKey,
          externalUserId: input.externalUserId,
          name: input.name,
          email: input.email,
          groups: input.groups,
          syncedAt: input.syncedAt,
        },
        update: {
          name: input.name,
          email: input.email,
          groups: input.groups,
          syncedAt: input.syncedAt,
        },
      });
      return toProfileRecord(profile);
    },

    async createActivityLog(input) {
      await prisma.activityLog.create({
        data: {
          appKey: input.appKey,
          eventType: input.eventType,
          message: input.message,
          requestId: input.requestId,
          correlationId: input.correlationId,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    },

    async listActivityLogs(input) {
      return prisma.activityLog.findMany({
        where: { appKey: input.appKey },
        select: {
          id: true,
          appKey: true,
          eventType: true,
          message: true,
          requestId: true,
          correlationId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
    },

    async findProcessedEvent(input) {
      const event = await prisma.processedEvent.findUnique({
        where: {
          appKey_eventId: {
            appKey: input.appKey,
            eventId: input.eventId,
          },
        },
      });

      return event;
    },

    async tryInsertProcessedEvent(input) {
      const inserted = await prisma.$executeRaw`
        INSERT INTO "ProcessedEvent" ("appKey", "eventId", "eventType", "result")
        VALUES (${input.appKey}, ${input.eventId}, ${input.eventType}, ${input.result})
        ON CONFLICT ("appKey", "eventId") DO NOTHING
      `;
      return inserted === 1;
    },

    async updateProcessedEventResult(input) {
      await prisma.processedEvent.update({
        where: {
          appKey_eventId: {
            appKey: input.appKey,
            eventId: input.eventId,
          },
        },
        data: { result: input.result },
      });
    },

    async listProcessedEvents(input) {
      return prisma.processedEvent.findMany({
        where: { appKey: input.appKey },
        select: {
          appKey: true,
          eventId: true,
          eventType: true,
          result: true,
          processedAt: true,
        },
        orderBy: { processedAt: "desc" },
        take: input.limit,
      });
    },

    async revokeSessionsForLogoutEvent(input) {
      const result = await prisma.localSession.updateMany({
        where: {
          appKey: input.appKey,
          centralSessionId: input.centralSessionId ?? undefined,
          externalUserId: input.externalUserId,
          status: "active",
          revokedAt: null,
        },
        data: {
          status: "revoked",
          revokedAt: new Date(),
          revokeReason: input.reason,
        },
      });

      return result.count;
    },
  };

  return repository;
}
