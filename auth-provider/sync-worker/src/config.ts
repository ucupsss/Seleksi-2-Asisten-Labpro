import "dotenv/config";

export interface SyncWorkerConfig {
  rabbitUrl: string;
  rabbitQueue: string;
  rabbitRetryQueue: string;
  rabbitDlq: string;
  internalSecret: string;
  maxAttempts: number;
  retryDelayMs: number;
  outboxPollIntervalMs: number;
}

function numberFromEnv(value: string | undefined, fallback: number) {
  return value ? Number(value) : fallback;
}

export function loadSyncWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): SyncWorkerConfig {
  return {
    rabbitUrl: env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672",
    rabbitQueue: env.RABBITMQ_REVOCATION_QUEUE ?? "sso.revocations",
    rabbitRetryQueue:
      env.RABBITMQ_REVOCATION_RETRY_QUEUE ?? "sso.revocations.retry",
    rabbitDlq: env.RABBITMQ_REVOCATION_DLQ ?? "sso.revocations.dlq",
    internalSecret: env.INTERNAL_LOGOUT_SECRET ?? "dev-internal-secret",
    maxAttempts: numberFromEnv(env.SSO_DELIVERY_MAX_ATTEMPTS, 3),
    retryDelayMs: numberFromEnv(env.SSO_DELIVERY_RETRY_DELAY_MS, 5000),
    outboxPollIntervalMs: numberFromEnv(
      env.SSO_OUTBOX_POLL_INTERVAL_MS,
      1000,
    ),
  };
}
