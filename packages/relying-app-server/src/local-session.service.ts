import { addMinutes, randomToken, sha256Hex, type UserInfoResponse } from "@sso/shared";

export type LocalSessionStatus = "active" | "expired" | "revoked";

export interface LocalSessionRecord {
  id: string;
  appKey: string;
  sessionTokenHash: string;
  externalUserId: string;
  centralSessionId: string;
  status: LocalSessionStatus;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface ProfileRecord {
  appKey: string;
  externalUserId: string;
  name: string;
  email: string;
  groups: string[];
  syncedAt: Date;
}

export interface AuthenticatedLocalSessionRecord extends LocalSessionRecord {
  profile: ProfileRecord;
}

export interface ActivityLogRecord {
  id: string;
  appKey: string;
  eventType: string;
  message: string;
  requestId: string | null;
  correlationId: string | null;
  createdAt: Date;
}

export interface ActivityContext {
  requestId?: string;
  correlationId?: string;
}

export interface ProcessedEventRecord {
  appKey: string;
  eventId: string;
  eventType: string;
  result: string;
  processedAt: Date;
}

export interface LocalSessionRepository {
  withTransaction<T>(
    work: (repository: LocalSessionRepository) => Promise<T>,
  ): Promise<T>;
  createLocalSession(input: {
    appKey: string;
    sessionTokenHash: string;
    externalUserId: string;
    centralSessionId: string;
    expiresAt: Date;
  }): Promise<LocalSessionRecord>;
  findSessionByHash(input: {
    appKey: string;
    sessionTokenHash: string;
  }): Promise<LocalSessionRecord | null>;
  markSessionExpired(input: {
    appKey: string;
    sessionTokenHash: string;
  }): Promise<void>;
  findActiveSessionByHash(input: {
    appKey: string;
    sessionTokenHash: string;
  }): Promise<AuthenticatedLocalSessionRecord | null>;
  revokeSessionByHash(input: {
    appKey: string;
    sessionTokenHash: string;
    reason: string;
  }): Promise<LocalSessionRecord | null>;
  upsertProfile(input: {
    appKey: string;
    externalUserId: string;
    name: string;
    email: string;
    groups: string[];
    syncedAt: Date;
  }): Promise<ProfileRecord>;
  createActivityLog(input: {
    appKey: string;
    eventType: string;
    message: string;
    requestId?: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  listActivityLogs(input: {
    appKey: string;
    limit: number;
  }): Promise<ActivityLogRecord[]>;
  findProcessedEvent(input: {
    appKey: string;
    eventId: string;
  }): Promise<{ appKey: string; eventId: string } | null>;
  tryInsertProcessedEvent(input: {
    appKey: string;
    eventId: string;
    eventType: string;
    result: string;
  }): Promise<boolean>;
  updateProcessedEventResult(input: {
    appKey: string;
    eventId: string;
    result: string;
  }): Promise<void>;
  listProcessedEvents(input: {
    appKey: string;
    limit: number;
  }): Promise<ProcessedEventRecord[]>;
  revokeSessionsForLogoutEvent(input: {
    appKey?: string;
    centralSessionId: string | null;
    externalUserId: string;
    reason: string;
  }): Promise<number>;
}

export type LocalSessionView =
  | { status: "anonymous" }
  | {
      status: "expired" | "revoked";
      session: {
        status: "expired" | "revoked";
        createdAt: Date;
        expiresAt: Date;
      };
    }
  | {
      status: "authenticated";
      user: {
        name: string;
        email: string;
        groups: string[];
      };
      session: {
        status: "active";
        createdAt: Date;
        expiresAt: Date;
      };
    };

export interface LocalSessionService {
  createSessionFromUserInfo(
    userInfo: UserInfoResponse,
    context?: ActivityContext,
  ): Promise<{ sessionToken: string; session: LocalSessionRecord }>;
  getCurrentSession(sessionToken: string | undefined): Promise<LocalSessionView>;
  logout(
    sessionToken: string | undefined,
    context?: ActivityContext,
  ): Promise<void>;
  recordActivity(input: ActivityContext & {
    eventType: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  listActivityLogs(limit: number): Promise<ActivityLogRecord[]>;
  listProcessedEvents(limit: number): Promise<ProcessedEventRecord[]>;
  processInternalLogout(input: {
    eventId: string;
    eventType: string;
    externalUserId: string;
    centralSessionId: string | null;
    reason: string;
    requestId?: string;
    correlationId?: string;
  }): Promise<{ alreadyProcessed: boolean; revokedCount: number }>;
}

export interface LocalSessionServiceDependencies {
  appKey: string;
  repository: LocalSessionRepository;
  generateToken?: () => string;
  now?: () => Date;
  sessionTtlMinutes: number;
}

export function createLocalSessionService(
  deps: LocalSessionServiceDependencies,
): LocalSessionService {
  const generateToken = deps.generateToken ?? (() => randomToken());
  const now = deps.now ?? (() => new Date());

  return {
    async createSessionFromUserInfo(userInfo, context) {
      const currentTime = now();
      const sessionToken = generateToken();
      const session = await deps.repository.withTransaction(async (repository) => {
        await repository.upsertProfile({
          appKey: deps.appKey,
          externalUserId: userInfo.sub,
          name: userInfo.name,
          email: userInfo.email,
          groups: userInfo.groups,
          syncedAt: currentTime,
        });

        const createdSession = await repository.createLocalSession({
          appKey: deps.appKey,
          sessionTokenHash: sha256Hex(sessionToken),
          externalUserId: userInfo.sub,
          centralSessionId: userInfo.centralSessionId,
          expiresAt: addMinutes(currentTime, deps.sessionTtlMinutes),
        });

        await repository.createActivityLog({
          appKey: deps.appKey,
          eventType: "local_login_success",
          message: "Local session created from SSO userinfo.",
          requestId: context?.requestId,
          correlationId: context?.correlationId,
          metadata: {
            externalUserId: userInfo.sub,
            centralSessionId: userInfo.centralSessionId,
          },
        });
        return createdSession;
      });

      return { sessionToken, session };
    },

    async getCurrentSession(sessionToken) {
      if (!sessionToken) {
        return { status: "anonymous" };
      }

      const sessionTokenHash = sha256Hex(sessionToken);
      const storedSession = await deps.repository.findSessionByHash({
        appKey: deps.appKey,
        sessionTokenHash,
      });

      if (!storedSession) return { status: "anonymous" };

      const currentTime = now();
      if (
        storedSession.status === "expired" ||
        (storedSession.status === "active" &&
          storedSession.expiresAt.getTime() <= currentTime.getTime())
      ) {
        if (storedSession.status === "active") {
          await deps.repository.markSessionExpired({
            appKey: deps.appKey,
            sessionTokenHash,
          });
        }
        return {
          status: "expired",
          session: {
            status: "expired",
            createdAt: storedSession.createdAt,
            expiresAt: storedSession.expiresAt,
          },
        };
      }

      if (storedSession.status === "revoked" || storedSession.revokedAt) {
        return {
          status: "revoked",
          session: {
            status: "revoked",
            createdAt: storedSession.createdAt,
            expiresAt: storedSession.expiresAt,
          },
        };
      }

      const session = await deps.repository.findActiveSessionByHash({
        appKey: deps.appKey,
        sessionTokenHash,
      });

      if (!session) {
        return { status: "anonymous" };
      }

      return {
        status: "authenticated",
        user: {
          name: session.profile.name,
          email: session.profile.email,
          groups: session.profile.groups,
        },
        session: {
          status: "active",
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      };
    },

    async logout(sessionToken, context) {
      if (!sessionToken) {
        return;
      }

      await deps.repository.withTransaction(async (repository) => {
        const session = await repository.revokeSessionByHash({
          appKey: deps.appKey,
          sessionTokenHash: sha256Hex(sessionToken),
          reason: "local_logout",
        });

        if (session) {
          await repository.createActivityLog({
            appKey: deps.appKey,
            eventType: "local_logout",
            message: "Local session revoked by relying app logout.",
            requestId: context?.requestId,
            correlationId: context?.correlationId,
            metadata: {
              externalUserId: session.externalUserId,
              centralSessionId: session.centralSessionId,
            },
          });
        }
      });
    },

    async recordActivity(input) {
      await deps.repository.createActivityLog({
        appKey: deps.appKey,
        eventType: input.eventType,
        message: input.message,
        requestId: input.requestId,
        correlationId: input.correlationId,
        metadata: input.metadata,
      });
    },

    async listActivityLogs(limit) {
      return deps.repository.listActivityLogs({ appKey: deps.appKey, limit });
    },

    async listProcessedEvents(limit) {
      return deps.repository.listProcessedEvents({
        appKey: deps.appKey,
        limit,
      });
    },

    async processInternalLogout(input) {
      return deps.repository.withTransaction(async (repository) => {
        const claimed = await repository.tryInsertProcessedEvent({
          appKey: deps.appKey,
          eventId: input.eventId,
          eventType: input.eventType,
          result: "processing",
        });

        if (!claimed) {
          return { alreadyProcessed: true, revokedCount: 0 };
        }

        const revokedCount = await repository.revokeSessionsForLogoutEvent({
          appKey: deps.appKey,
          centralSessionId: input.centralSessionId,
          externalUserId: input.externalUserId,
          reason: input.reason,
        });
        const result = `revoked_local_sessions:${revokedCount}`;

        await repository.updateProcessedEventResult({
          appKey: deps.appKey,
          eventId: input.eventId,
          result,
        });

        await repository.createActivityLog({
          appKey: deps.appKey,
          eventType: "internal_logout_processed",
          message: "Internal logout event processed.",
          requestId: input.requestId,
          correlationId: input.correlationId ?? input.eventId,
          metadata: {
            eventId: input.eventId,
            result,
            revokedCount,
            centralSessionId: input.centralSessionId,
            externalUserId: input.externalUserId,
          },
        });

        return { alreadyProcessed: false, revokedCount };
      });
    },
  };
}
