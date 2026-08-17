import type { PrismaClient } from "../../../../node_modules/.prisma/local-client/index.js";
import { describe, expect, it, vi } from "vitest";
import { createPrismaLocalSessionRepository } from "../prisma-local-session.repository.js";

describe("Prisma local session repository", () => {
  it("looks up processed events by app and event id", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      appKey: "app-b",
      eventId: "event-1",
    });
    const prisma = {
      processedEvent: { findUnique },
    } as unknown as PrismaClient;
    const repository = createPrismaLocalSessionRepository(prisma);

    await repository.findProcessedEvent({
      appKey: "app-b",
      eventId: "event-1",
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        appKey_eventId: {
          appKey: "app-b",
          eventId: "event-1",
        },
      },
    });
  });

  it("lists only the requested app activity with a bounded result", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      activityLog: { findMany },
    } as unknown as PrismaClient;
    const repository = createPrismaLocalSessionRepository(prisma);

    await repository.listActivityLogs({ appKey: "app-a", limit: 25 });

    expect(findMany).toHaveBeenCalledWith({
      where: { appKey: "app-a" },
      select: {
        id: true,
        appKey: true,
        eventType: true,
        message: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
  });

  it("lists processed events by app without crossing tenant scope", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      processedEvent: { findMany },
    } as unknown as PrismaClient;
    const repository = createPrismaLocalSessionRepository(prisma);

    await repository.listProcessedEvents({ appKey: "app-b", limit: 50 });

    expect(findMany).toHaveBeenCalledWith({
      where: { appKey: "app-b" },
      select: {
        appKey: true,
        eventId: true,
        eventType: true,
        result: true,
        processedAt: true,
      },
      orderBy: { processedAt: "desc" },
      take: 50,
    });
  });
});
