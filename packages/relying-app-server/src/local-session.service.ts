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

export interface LocalSessionRepository {
  createLocalSession(input: {
    appKey: string;
    sessionTokenHash: string;
    externalUserId: string;
    centralSessionId: string;
    expiresAt: Date;
  }): Promise<LocalSessionRecord>;
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
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  findProcessedEvent(input: {
    appKey: string;
    eventId: string;
  }): Promise<{ appKey: string; eventId: string } | null>;
  insertProcessedEvent(input: {
    appKey: string;
    eventId: string;
    eventType: string;
    result: string;
  }): Promise<void>;
  revokeSessionsForLogoutEvent(input: {
    appKey?: string;
    centralSessionId: string;
    externalUserId: string;
    reason: string;
  }): Promise<number>;
}

export type LocalSessionView =
  | { status: "anonymous" }
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
  ): Promise<{ sessionToken: string; session: LocalSessionRecord }>;
  getCurrentSession(sessionToken: string | undefined): Promise<LocalSessionView>;
  logout(sessionToken: string | undefined): Promise<void>;
  processInternalLogout(input: {
    eventId: string;
    eventType: string;
    externalUserId: string;
    centralSessionId: string;
    reason: string;
    appKey?: string | null;
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
    async createSessionFromUserInfo(userInfo) {
      const currentTime = now();
      const sessionToken = generateToken();

      await deps.repository.upsertProfile({
        appKey: deps.appKey,
        externalUserId: userInfo.sub,
        name: userInfo.name,
        email: userInfo.email,
        groups: userInfo.groups,
        syncedAt: currentTime,
      });

      const session = await deps.repository.createLocalSession({
        appKey: deps.appKey,
        sessionTokenHash: sha256Hex(sessionToken),
        externalUserId: userInfo.sub,
        centralSessionId: userInfo.centralSessionId,
        expiresAt: addMinutes(currentTime, deps.sessionTtlMinutes),
      });

      await deps.repository.createActivityLog({
        appKey: deps.appKey,
        eventType: "local_login_success",
        message: "Local session created from SSO userinfo.",
        metadata: {
          externalUserId: userInfo.sub,
          centralSessionId: userInfo.centralSessionId,
        },
      });

      return { sessionToken, session };
    },

    async getCurrentSession(sessionToken) {
      if (!sessionToken) {
        return { status: "anonymous" };
      }

      const session = await deps.repository.findActiveSessionByHash({
        appKey: deps.appKey,
        sessionTokenHash: sha256Hex(sessionToken),
      });

      if (!session || session.expiresAt.getTime() <= now().getTime()) {
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

    async logout(sessionToken) {
      if (!sessionToken) {
        return;
      }

      const session = await deps.repository.revokeSessionByHash({
        appKey: deps.appKey,
        sessionTokenHash: sha256Hex(sessionToken),
        reason: "local_logout",
      });

      if (session) {
        await deps.repository.createActivityLog({
          appKey: deps.appKey,
          eventType: "local_logout",
          message: "Local session revoked by relying app logout.",
          metadata: {
            externalUserId: session.externalUserId,
            centralSessionId: session.centralSessionId,
          },
        });
      }
    },

    async processInternalLogout(input) {
      const existing = await deps.repository.findProcessedEvent({
        appKey: deps.appKey,
        eventId: input.eventId,
      });

      if (existing) {
        return { alreadyProcessed: true, revokedCount: 0 };
      }

      const revokedCount = await deps.repository.revokeSessionsForLogoutEvent({
        appKey: input.appKey ?? deps.appKey,
        centralSessionId: input.centralSessionId,
        externalUserId: input.externalUserId,
        reason: input.reason,
      });

      await deps.repository.insertProcessedEvent({
        appKey: deps.appKey,
        eventId: input.eventId,
        eventType: input.eventType,
        result: "success",
      });

      await deps.repository.createActivityLog({
        appKey: deps.appKey,
        eventType: "internal_logout_processed",
        message: "Internal logout event processed.",
        metadata: {
          eventId: input.eventId,
          revokedCount,
          centralSessionId: input.centralSessionId,
          externalUserId: input.externalUserId,
        },
      });

      return { alreadyProcessed: false, revokedCount };
    },
  };
}
