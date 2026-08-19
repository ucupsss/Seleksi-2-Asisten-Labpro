import amqp from "amqplib";
import { Router, type Response } from "express";
import type { AuthConfig } from "../config.js";
import { authDb } from "../db.js";

export interface ReadinessChecks {
  database(): Promise<void>;
  messageBroker(): Promise<void>;
}

type ComponentStatus = "up" | "down";

function sendLiveness(res: Response) {
  res.json({ status: "ok", service: "auth-server" });
}

async function runCheck(
  check: () => Promise<void>,
  timeoutMs: number,
): Promise<ComponentStatus> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      Promise.resolve().then(check),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Readiness check timed out")),
          timeoutMs,
        );
      }),
    ]);
    return "up";
  } catch {
    return "down";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createDefaultReadinessChecks(
  config: Pick<AuthConfig, "rabbitUrl" | "healthReadinessTimeoutMs">,
): ReadinessChecks {
  return {
    async database() {
      await authDb.$queryRaw`SELECT 1`;
    },
    async messageBroker() {
      const connection = await amqp.connect(config.rabbitUrl, {
        timeout: config.healthReadinessTimeoutMs,
      });
      await connection.close();
    },
  };
}

export function createHealthRoutes(
  checks: ReadinessChecks,
  timeoutMs: number,
) {
  const router = Router();

  // Backward-compatible health endpoint used by existing integrations.
  router.get("/health", (_req, res) => sendLiveness(res));
  router.get("/health/live", (_req, res) => sendLiveness(res));

  router.get("/health/ready", async (_req, res) => {
    const [database, messageBroker] = await Promise.all([
      runCheck(() => checks.database(), timeoutMs),
      runCheck(() => checks.messageBroker(), timeoutMs),
    ]);
    const ready = database === "up" && messageBroker === "up";

    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      service: "auth-server",
      checks: {
        database: { status: database },
        messageBroker: { status: messageBroker },
      },
    });
  });

  return router;
}
