import { describe, expect, it } from "vitest";
import { loadSyncWorkerConfig } from "../config.js";

describe("sync worker config", () => {
  it("loads RabbitMQ and polling defaults", () => {
    const config = loadSyncWorkerConfig({
      RABBITMQ_URL: "amqp://user:password@localhost:5672",
      INTERNAL_LOGOUT_SECRET: "internal-secret",
    });

    expect(config).toMatchObject({
      rabbitUrl: "amqp://user:password@localhost:5672",
      rabbitQueue: "sso.revocations",
      rabbitRetryQueue: "sso.revocations.retry",
      rabbitDlq: "sso.revocations.dlq",
      retryDelayMs: 5000,
      outboxPollIntervalMs: 1000,
    });
  });

  it("accepts deployment overrides", () => {
    const config = loadSyncWorkerConfig({
      RABBITMQ_URL: "amqp://rabbitmq:5672",
      INTERNAL_LOGOUT_SECRET: "internal-secret",
      RABBITMQ_REVOCATION_RETRY_QUEUE: "custom.retry",
      SSO_OUTBOX_POLL_INTERVAL_MS: "2500",
    });

    expect(config.rabbitUrl).toBe("amqp://rabbitmq:5672");
    expect(config.rabbitRetryQueue).toBe("custom.retry");
    expect(config.outboxPollIntervalMs).toBe(2500);
  });

  it("rejects missing broker and internal credentials", () => {
    expect(() => loadSyncWorkerConfig({})).toThrow("RABBITMQ_URL is required");
  });
});
