import type { RevocationEventPayload } from "@sso/shared";
import type { SyncWorkerConfig } from "./config.js";
import type { DeliveryService } from "./delivery.service.js";

export interface RabbitMessage {
  content: Buffer;
}

export interface RabbitChannel {
  assertQueue(
    queue: string,
    options: {
      durable: true;
      arguments?: Record<string, string | number>;
    },
  ): Promise<unknown> | unknown;
  sendToQueue(
    queue: string,
    content: Buffer,
    options: { persistent: true; contentType: "application/json" },
  ): boolean;
  waitForConfirms(): Promise<void>;
  ack(message: RabbitMessage): void;
  nack(message: RabbitMessage, allUpTo?: boolean, requeue?: boolean): void;
}

export async function setupRevocationTopology(
  channel: RabbitChannel,
  config: Pick<
    SyncWorkerConfig,
    "rabbitQueue" | "rabbitRetryQueue" | "rabbitDlq" | "retryDelayMs"
  >,
) {
  await channel.assertQueue(config.rabbitDlq, { durable: true });
  await channel.assertQueue(config.rabbitRetryQueue, {
    durable: true,
    arguments: {
      "x-message-ttl": config.retryDelayMs,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": config.rabbitQueue,
    },
  });
  await channel.assertQueue(config.rabbitQueue, { durable: true });
}

async function publishConfirmed(
  channel: RabbitChannel,
  queue: string,
  content: Buffer,
) {
  channel.sendToQueue(queue, content, {
    persistent: true,
    contentType: "application/json",
  });
  await channel.waitForConfirms();
}

export function createRabbitEventPublisher(
  channel: RabbitChannel,
  queue: string,
) {
  return {
    async publishRevocation(payload: RevocationEventPayload) {
      await publishConfirmed(
        channel,
        queue,
        Buffer.from(JSON.stringify(payload)),
      );
    },
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRevocationPayload(value: unknown): value is RevocationEventPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;

  return (
    typeof payload.eventId === "string" &&
    (payload.eventType === "SessionRevoked" ||
      payload.eventType === "PasswordChanged" ||
      payload.eventType === "AccessPolicyChanged") &&
    typeof payload.userId === "string" &&
    isNullableString(payload.centralSessionId) &&
    isNullableString(payload.applicationId) &&
    typeof payload.reason === "string" &&
    typeof payload.occurredAt === "string" &&
    typeof payload.metadata === "object" &&
    payload.metadata !== null &&
    !Array.isArray(payload.metadata)
  );
}

export function createRevocationMessageHandler(deps: {
  channel: RabbitChannel;
  retryQueue: string;
  deadLetterQueue: string;
  service: Pick<DeliveryService, "processRevocationEvent">;
}) {
  return async (message: RabbitMessage | null) => {
    if (!message) return;

    let payload: RevocationEventPayload;
    try {
      const parsed: unknown = JSON.parse(message.content.toString("utf8"));
      if (!isRevocationPayload(parsed)) {
        throw new Error("Invalid revocation event payload");
      }
      payload = parsed;
    } catch {
      try {
        await publishConfirmed(
          deps.channel,
          deps.deadLetterQueue,
          message.content,
        );
        deps.channel.ack(message);
      } catch {
        deps.channel.nack(message, false, true);
      }
      return;
    }

    try {
      const outcome = await deps.service.processRevocationEvent(payload);
      if (outcome === "processed") {
        deps.channel.ack(message);
        return;
      }

      const targetQueue =
        outcome === "retry" ? deps.retryQueue : deps.deadLetterQueue;
      await publishConfirmed(deps.channel, targetQueue, message.content);
      deps.channel.ack(message);
    } catch {
      try {
        await publishConfirmed(deps.channel, deps.retryQueue, message.content);
        deps.channel.ack(message);
      } catch {
        deps.channel.nack(message, false, true);
      }
    }
  };
}
