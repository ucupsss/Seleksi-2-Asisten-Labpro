import bcrypt from "bcrypt";
import { addMinutes, randomToken, sha256Hex } from "@sso/shared";
import type {
  Prisma,
  PrismaClient,
} from "../../../../node_modules/.prisma/auth-client/index.js";
import { HttpError } from "../errors.js";

export interface AuthUserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  status: "active" | "inactive";
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  sessionTokenHash: string;
  expiresAt: Date;
}

export interface ActiveSsoSessionRecord {
  id: string;
  userId: string;
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: AuthUserRecord;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  createSsoSession(input: {
    userId: string;
    sessionTokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuthSessionRecord>;
  findActiveSsoSessionByHash(
    sessionTokenHash: string,
  ): Promise<ActiveSsoSessionRecord | null>;
  revokeSsoSessionByHash(
    sessionTokenHash: string,
    reason: string,
  ): Promise<{ id: string; revokedAt: Date; reason: string } | null>;
  createAuditLog(input: {
    eventType: string;
    result: "success" | "failed";
    userId?: string;
    sessionId?: string;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface LoginInput {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface LoginResult {
  sessionToken: string;
  sessionId: string;
  expiresAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface SsoSessionContext {
  id: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface AuthService {
  loginWithPassword(input: LoginInput): Promise<LoginResult>;
  getCurrentSsoSession(sessionToken: string | undefined): Promise<SsoSessionContext | null>;
  logout(sessionToken: string | undefined, reason?: string): Promise<void>;
}

export interface AuthServiceDependencies {
  repository: AuthRepository;
  comparePassword?: (plainPassword: string, passwordHash: string) => Promise<boolean>;
  generateToken?: () => string;
  now?: () => Date;
  sessionTtlMinutes: number;
}

function toPublicUser(user: Pick<AuthUserRecord, "id" | "name" | "email">) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function invalidCredentialsError() {
  return new HttpError(
    401,
    "INVALID_CREDENTIALS",
    "Email atau password tidak valid",
  );
}

export function createAuthService(deps: AuthServiceDependencies): AuthService {
  const comparePassword =
    deps.comparePassword ?? ((plain, hash) => bcrypt.compare(plain, hash));
  const generateToken = deps.generateToken ?? (() => randomToken());
  const now = deps.now ?? (() => new Date());

  return {
    async loginWithPassword(input) {
      const user = await deps.repository.findUserByEmail(input.email);

      if (!user) {
        await deps.repository.createAuditLog({
          eventType: "login_failed",
          result: "failed",
          ipAddress: input.ipAddress,
          metadata: { reason: "invalid_credentials" },
        });
        throw invalidCredentialsError();
      }

      const passwordMatches = await comparePassword(
        input.password,
        user.passwordHash,
      );

      if (!passwordMatches) {
        await deps.repository.createAuditLog({
          eventType: "login_failed",
          result: "failed",
          userId: user.id,
          ipAddress: input.ipAddress,
          metadata: { reason: "invalid_credentials" },
        });
        throw invalidCredentialsError();
      }

      if (user.status !== "active") {
        await deps.repository.createAuditLog({
          eventType: "login_failed",
          result: "failed",
          userId: user.id,
          ipAddress: input.ipAddress,
          metadata: { reason: "inactive_user" },
        });
        throw new HttpError(403, "FORBIDDEN", "User tidak aktif");
      }

      const sessionToken = generateToken();
      const session = await deps.repository.createSsoSession({
        userId: user.id,
        sessionTokenHash: sha256Hex(sessionToken),
        expiresAt: addMinutes(now(), deps.sessionTtlMinutes),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      await deps.repository.createAuditLog({
        eventType: "login_success",
        result: "success",
        userId: user.id,
        sessionId: session.id,
        ipAddress: input.ipAddress,
      });

      return {
        sessionToken,
        sessionId: session.id,
        expiresAt: session.expiresAt,
        user: toPublicUser(user),
      };
    },

    async getCurrentSsoSession(sessionToken) {
      if (!sessionToken) {
        return null;
      }

      const session = await deps.repository.findActiveSsoSessionByHash(
        sha256Hex(sessionToken),
      );

      if (
        !session ||
        session.status !== "active" ||
        session.revokedAt ||
        session.expiresAt.getTime() <= now().getTime() ||
        session.user.status !== "active"
      ) {
        return null;
      }

      return {
        id: session.id,
        user: toPublicUser(session.user),
      };
    },

    async logout(sessionToken, reason = "sso_logout") {
      if (!sessionToken) {
        return;
      }

      const revoked = await deps.repository.revokeSsoSessionByHash(
        sha256Hex(sessionToken),
        reason,
      );

      if (revoked) {
        await deps.repository.createAuditLog({
          eventType: "logout",
          result: "success",
          sessionId: revoked.id,
          metadata: { reason },
        });
      }
    },
  };
}

export function createPrismaAuthRepository(prisma: PrismaClient): AuthRepository {
  return {
    async findUserByEmail(email) {
      return prisma.user.findUnique({ where: { email } });
    },

    async createSsoSession(input) {
      return prisma.ssoSession.create({
        data: {
          userId: input.userId,
          sessionTokenHash: input.sessionTokenHash,
          expiresAt: input.expiresAt,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
    },

    async findActiveSsoSessionByHash(sessionTokenHash) {
      return prisma.ssoSession.findUnique({
        where: { sessionTokenHash },
        include: { user: true },
      });
    },

    async revokeSsoSessionByHash(sessionTokenHash, reason) {
      const existing = await prisma.ssoSession.findUnique({
        where: { sessionTokenHash },
      });

      if (!existing) {
        return null;
      }

      const revokedAt = new Date();
      const session = await prisma.ssoSession.update({
        where: { sessionTokenHash },
        data: {
          status: "revoked",
          revokedAt,
          revokeReason: reason,
        },
      });

      return { id: session.id, revokedAt, reason };
    },

    async createAuditLog(input) {
      await prisma.auditLog.create({
        data: {
          eventType: input.eventType,
          result: input.result,
          userId: input.userId,
          sessionId: input.sessionId,
          ipAddress: input.ipAddress,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    },
  };
}
