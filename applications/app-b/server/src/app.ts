import { createAppServer } from "@sso/relying-app-server";
import { loadAppBConfig } from "./config.js";
import { localDb } from "./db.js";

export function createAppB() {
  return createAppServer(loadAppBConfig(), { prisma: localDb });
}
