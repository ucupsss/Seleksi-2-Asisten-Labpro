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
});
