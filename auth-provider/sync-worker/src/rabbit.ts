import type { RevocationEventPayload } from "@sso/shared";
import type { SyncWorkerConfig } from "./config.js";

export interface RabbitChannel {
  assertQueue(
    queue: string,
    options: { durable: true },
  ): Promise<unknown> | unknown;
  sendToQueue(
    queue: string,
    content: Buffer,
    options: { persistent: true; contentType: "application/json" },
  ): boolean;
}

export async function setupRevocationQueues(
  channel: RabbitChannel,
  config: Pick<SyncWorkerConfig, "rabbitQueue" | "rabbitDlq">,
) {
  await channel.assertQueue(config.rabbitQueue, { durable: true });
  await channel.assertQueue(config.rabbitDlq, { durable: true });
}

export function publishRevocationToQueue(
  channel: RabbitChannel,
  queue: string,
  payload: RevocationEventPayload,
) {
  return channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json",
  });
}
