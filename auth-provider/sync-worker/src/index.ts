import amqp, {
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";
import { PrismaClient } from "../../../node_modules/.prisma/auth-client/index.js";
import { loadSyncWorkerConfig } from "./config.js";
import {
  createDeliveryService,
  createFetchInternalLogoutClient,
  createPrismaDeliveryRepository,
} from "./delivery.service.js";
import {
  createOutboxService,
  createPrismaOutboxRepository,
} from "./outbox.service.js";
import {
  createRabbitEventPublisher,
  createRevocationMessageHandler,
  setupRevocationTopology,
  type RabbitChannel,
  type RabbitMessage,
} from "./rabbit.js";

const prisma = new PrismaClient();
const config = loadSyncWorkerConfig();

function adaptChannel(channel: ConfirmChannel): RabbitChannel {
  return {
    assertQueue: (queue, options) => channel.assertQueue(queue, options),
    sendToQueue: (queue, content, options) =>
      channel.sendToQueue(queue, content, options),
    waitForConfirms: () => channel.waitForConfirms(),
    ack: (message) => channel.ack(message as ConsumeMessage),
    nack: (message, allUpTo, requeue) =>
      channel.nack(message as ConsumeMessage, allUpTo, requeue),
  };
}

async function start() {
  const connection = await amqp.connect(config.rabbitUrl);
  const channel = await connection.createConfirmChannel();
  const rabbitChannel = adaptChannel(channel);

  await setupRevocationTopology(rabbitChannel, config);
  await channel.prefetch(1);

  const deliveryService = createDeliveryService({
    repository: createPrismaDeliveryRepository(prisma),
    client: createFetchInternalLogoutClient(),
    internalSecret: config.internalSecret,
    maxAttempts: config.maxAttempts,
    retryDelayMs: config.retryDelayMs,
  });
  const outboxService = createOutboxService({
    repository: createPrismaOutboxRepository(prisma),
    publisher: createRabbitEventPublisher(rabbitChannel, config.rabbitQueue),
  });
  const handleMessage = createRevocationMessageHandler({
    channel: rabbitChannel,
    retryQueue: config.rabbitRetryQueue,
    deadLetterQueue: config.rabbitDlq,
    service: deliveryService,
  });

  await channel.consume(
    config.rabbitQueue,
    (message) => {
      void handleMessage(message as RabbitMessage | null).catch((error) => {
        console.error("Unhandled revocation message error", error);
      });
    },
    { noAck: false },
  );

  let polling = false;
  const pollOutbox = async () => {
    if (polling) return;
    polling = true;
    try {
      await outboxService.publishPendingEvents();
    } catch (error) {
      console.error("Failed to publish pending SSO events", error);
    } finally {
      polling = false;
    }
  };

  await pollOutbox();
  const pollTimer = setInterval(
    () => void pollOutbox(),
    config.outboxPollIntervalMs,
  );

  let shuttingDown = false;
  const shutdown = async () => {
    shuttingDown = true;
    clearInterval(pollTimer);
    await channel.close().catch(() => undefined);
    await connection.close().catch(() => undefined);
    await prisma.$disconnect();
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  connection.on("error", (error) => {
    if (!shuttingDown) console.error("RabbitMQ connection error", error);
  });
  connection.once("close", async () => {
    clearInterval(pollTimer);
    if (!shuttingDown) {
      console.error("RabbitMQ connection closed unexpectedly");
      await prisma.$disconnect();
      process.exit(1);
    }
  });

  console.log("SSO sync worker ready. RabbitMQ revocation consumer active.");
}

start().catch(async (error) => {
  console.error("SSO sync worker failed to start", error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
