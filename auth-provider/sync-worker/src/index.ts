import type { RevocationEventPayload } from "@sso/shared";
import { PrismaClient } from "../../../node_modules/.prisma/auth-client/index.js";
import { loadSyncWorkerConfig } from "./config.js";
import {
  createDeliveryService,
  createFetchInternalLogoutClient,
  createPrismaDeliveryRepository,
} from "./delivery.service.js";

const prisma = new PrismaClient();
const config = loadSyncWorkerConfig();
const service = createDeliveryService({
  repository: createPrismaDeliveryRepository(prisma),
  client: createFetchInternalLogoutClient(),
  internalSecret: config.internalSecret,
  maxAttempts: config.maxAttempts,
  retryDelayMs: config.retryDelayMs,
});

export async function processRevocationEvent(payload: RevocationEventPayload) {
  await service.processRevocationEvent(payload);
}

console.log("SSO sync worker ready. Waiting for revocation events.");
setInterval(() => {}, 60_000);
