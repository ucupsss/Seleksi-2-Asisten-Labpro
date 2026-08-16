import type { RevocationEventPayload } from "@sso/shared";
import { describe, expect, it } from "vitest";
import {
  createRabbitEventPublisher,
  createRevocationMessageHandler,
  setupRevocationTopology,
  type RabbitChannel,
  type RabbitMessage,
} from "../rabbit.js";

const payload: RevocationEventPayload = {
  eventId: "event-1",
  eventType: "SessionRevoked",
  userId: "user-1",
  centralSessionId: "central-session-1",
  applicationId: null,
  reason: "sso_logout",
  occurredAt: "2026-08-16T10:00:00.000Z",
  metadata: {},
};

function createChannel() {
  const assertedQueues: Array<{ queue: string; options: unknown }> = [];
  const sent: Array<{ queue: string; body: string; options: unknown }> = [];
  const acknowledged: RabbitMessage[] = [];
  const rejected: RabbitMessage[] = [];
  let confirmCount = 0;

  const channel: RabbitChannel = {
    assertQueue: async (queue, options) => {
      assertedQueues.push({ queue, options });
      return {};
    },
    sendToQueue: (queue, content, options) => {
      sent.push({ queue, body: content.toString("utf8"), options });
      return true;
    },
    waitForConfirms: async () => {
      confirmCount += 1;
    },
    ack: (message) => {
      acknowledged.push(message);
    },
    nack: (message) => {
      rejected.push(message);
    },
  };

  return {
    channel,
    assertedQueues,
    sent,
    acknowledged,
    rejected,
    getConfirmCount: () => confirmCount,
  };
}

function messageFor(value: unknown): RabbitMessage {
  return { content: Buffer.from(JSON.stringify(value)) };
}

describe("RabbitMQ revocation topology", () => {
  it("declares durable main, retry, and dead-letter queues", async () => {
    const { channel, assertedQueues } = createChannel();

    await setupRevocationTopology(channel, {
      rabbitQueue: "sso.revocations",
      rabbitRetryQueue: "sso.revocations.retry",
      rabbitDlq: "sso.revocations.dlq",
      retryDelayMs: 5000,
    });

    expect(assertedQueues).toEqual([
      {
        queue: "sso.revocations.dlq",
        options: { durable: true },
      },
      {
        queue: "sso.revocations.retry",
        options: {
          durable: true,
          arguments: {
            "x-message-ttl": 5000,
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": "sso.revocations",
          },
        },
      },
      {
        queue: "sso.revocations",
        options: { durable: true },
      },
    ]);
  });

  it("publishes persistent outbox messages only after broker confirmation", async () => {
    const { channel, sent, getConfirmCount } = createChannel();
    const publisher = createRabbitEventPublisher(
      channel,
      "sso.revocations",
    );

    await publisher.publishRevocation(payload);

    expect(sent).toEqual([
      {
        queue: "sso.revocations",
        body: JSON.stringify(payload),
        options: { persistent: true, contentType: "application/json" },
      },
    ]);
    expect(getConfirmCount()).toBe(1);
  });
});

describe("RabbitMQ revocation consumer", () => {
  it("sends transient delivery failures to the retry queue before ack", async () => {
    const { channel, sent, acknowledged, getConfirmCount } = createChannel();
    const message = messageFor(payload);
    const handler = createRevocationMessageHandler({
      channel,
      retryQueue: "sso.revocations.retry",
      deadLetterQueue: "sso.revocations.dlq",
      service: {
        processRevocationEvent: async () => "retry",
      },
    });

    await handler(message);

    expect(sent[0]).toMatchObject({
      queue: "sso.revocations.retry",
      body: JSON.stringify(payload),
    });
    expect(getConfirmCount()).toBe(1);
    expect(acknowledged).toEqual([message]);
  });

  it("sends permanent failures and malformed messages to the DLQ", async () => {
    const first = createChannel();
    const deadLetterMessage = messageFor(payload);
    const deadLetterHandler = createRevocationMessageHandler({
      channel: first.channel,
      retryQueue: "sso.revocations.retry",
      deadLetterQueue: "sso.revocations.dlq",
      service: {
        processRevocationEvent: async () => "dead_letter",
      },
    });

    await deadLetterHandler(deadLetterMessage);

    const second = createChannel();
    const malformedMessage = { content: Buffer.from("not-json") };
    const malformedHandler = createRevocationMessageHandler({
      channel: second.channel,
      retryQueue: "sso.revocations.retry",
      deadLetterQueue: "sso.revocations.dlq",
      service: {
        processRevocationEvent: async () => "processed",
      },
    });

    await malformedHandler(malformedMessage);

    expect(first.sent[0]?.queue).toBe("sso.revocations.dlq");
    expect(second.sent[0]?.queue).toBe("sso.revocations.dlq");
    expect(first.acknowledged).toEqual([deadLetterMessage]);
    expect(second.acknowledged).toEqual([malformedMessage]);
  });
});
