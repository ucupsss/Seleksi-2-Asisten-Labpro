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

function requiredEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadSyncWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): SyncWorkerConfig {
  return {
    rabbitUrl: requiredEnv(env, "RABBITMQ_URL"),
    rabbitQueue: env.RABBITMQ_REVOCATION_QUEUE ?? "sso.revocations",
    rabbitRetryQueue:
      env.RABBITMQ_REVOCATION_RETRY_QUEUE ?? "sso.revocations.retry",
    rabbitDlq: env.RABBITMQ_REVOCATION_DLQ ?? "sso.revocations.dlq",
    internalSecret: requiredEnv(env, "INTERNAL_LOGOUT_SECRET"),
    maxAttempts: numberFromEnv(env.SSO_DELIVERY_MAX_ATTEMPTS, 3),
    retryDelayMs: numberFromEnv(env.SSO_DELIVERY_RETRY_DELAY_MS, 5000),
    outboxPollIntervalMs: numberFromEnv(
      env.SSO_OUTBOX_POLL_INTERVAL_MS,
      1000,
    ),
  };
}
