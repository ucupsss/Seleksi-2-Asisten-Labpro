import "dotenv/config";

export interface SyncWorkerConfig {
  rabbitQueue: string;
  rabbitDlq: string;
  internalSecret: string;
  maxAttempts: number;
  retryDelayMs: number;
}

function numberFromEnv(value: string | undefined, fallback: number) {
  return value ? Number(value) : fallback;
}

export function loadSyncWorkerConfig(): SyncWorkerConfig {
  return {
    rabbitQueue: process.env.RABBITMQ_REVOCATION_QUEUE ?? "sso.revocations",
    rabbitDlq: process.env.RABBITMQ_REVOCATION_DLQ ?? "sso.revocations.dlq",
    internalSecret: process.env.INTERNAL_LOGOUT_SECRET ?? "dev-internal-secret",
    maxAttempts: numberFromEnv(process.env.SSO_DELIVERY_MAX_ATTEMPTS, 3),
    retryDelayMs: numberFromEnv(process.env.SSO_DELIVERY_RETRY_DELAY_MS, 5000),
  };
}
