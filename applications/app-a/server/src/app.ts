import { createAppServer } from "@sso/relying-app-server";
import { loadAppAConfig } from "./config.js";
import { localDb } from "./db.js";

export function createAppA() {
  return createAppServer(loadAppAConfig(), { prisma: localDb });
}
