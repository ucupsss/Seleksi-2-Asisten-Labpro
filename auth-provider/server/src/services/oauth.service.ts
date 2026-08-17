import { createHash } from "node:crypto";
import {
  addMinutes,
  randomToken,
  sha256Hex,
  type TokenResponse,
  type UserInfoResponse,
} from "@sso/shared";
import type {
  Prisma,
  PrismaClient,
} from "../../../../node_modules/.prisma/auth-client/index.js";
import { HttpError } from "../errors.js";
import type {
  PolicyApplicationRecord,
  PolicyService,
  PolicyUserRecord,
} from "./policy.service.js";

export interface AuthorizationCodeRecord {
  id: string;
  codeHash: string;
  userId: string;
  applicationId: string;
  ssoSessionId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: Date;
  usedAt: Date | null;
  application: PolicyApplicationRecord;
  user: PolicyUserRecord;
  ssoSession: {
    id: string;
    status: "active" | "expired" | "revoked";
    expiresAt: Date;
    revokedAt: Date | null;
  };
}

export interface AccessTokenRecord {
  tokenHash: string;
  userId: string;
  applicationId: string;
  ssoSessionId: string;
  expiresAt: Date;
  status: "active" | "expired" | "revoked";
  application: PolicyApplicationRecord;
  user: PolicyUserRecord;
  ssoSession: {
    id: string;
    status: "active" | "expired" | "revoked";
    expiresAt: Date;
    revokedAt: Date | null;
  };
  groups?: string[];
}

export interface OauthRepository {
  withTransaction<T>(
    work: (repository: OauthRepository) => Promise<T>,
  ): Promise<T>;
  createAuthorizationCode(input: {
    codeHash: string;
    userId: string;
    applicationId: string;
    ssoSessionId: string;
    redirectUri: string;
    codeChallenge: string;
    expiresAt: Date;
  }): Promise<AuthorizationCodeRecord>;
  findAuthorizationCodeByHash(
    codeHash: string,
  ): Promise<AuthorizationCodeRecord | null>;
  consumeAuthorizationCode(id: string, usedAt: Date): Promise<boolean>;
  createAccessToken(input: {
    tokenHash: string;
    userId: string;
    applicationId: string;
    ssoSessionId: string;
    expiresAt: Date;
  }): Promise<AccessTokenRecord>;
  findAccessTokenByHash(tokenHash: string): Promise<AccessTokenRecord | null>;
  findUserGroups(userId: string): Promise<string[]>;
  createAuditLog(input: {
    eventType: string;
    result: "success" | "failed";
    userId?: string;
    applicationId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface CreateAuthorizationCodeInput {
  userId: string;
  ssoSessionId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

export interface ExchangeAuthorizationCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface OauthService {
  createAuthorizationCode(
    input: CreateAuthorizationCodeInput,
  ): Promise<{ code: string; redirectTo: string }>;
  exchangeAuthorizationCode(
    input: ExchangeAuthorizationCodeInput,
  ): Promise<TokenResponse>;
  getUserInfo(accessToken: string | undefined): Promise<UserInfoResponse>;
}

export interface OauthServiceDependencies {
  repository: OauthRepository;
  policyService: PolicyService;
  generateCode?: () => string;
  generateToken?: () => string;
  now?: () => Date;
  authorizationCodeTtlMinutes: number;
  accessTokenTtlMinutes: number;
}

function invalidGrant(message = "Authorization grant tidak valid") {
  return new HttpError(400, "INVALID_GRANT", message);
}

function createPkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function sessionIsActive(
  session: { status: string; expiresAt: Date; revokedAt: Date | null },
  now: Date,
) {
  return (
    session.status === "active" &&
    !session.revokedAt &&
    session.expiresAt.getTime() > now.getTime()
  );
}

export function createOauthService(deps: OauthServiceDependencies): OauthService {
  const generateCode = deps.generateCode ?? (() => randomToken(24));
  const generateToken = deps.generateToken ?? (() => randomToken(32));
  const now = deps.now ?? (() => new Date());

  return {
    async createAuthorizationCode(input) {
      const decision = await deps.policyService.evaluateApplicationAccess({
        userId: input.userId,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
      });

      if (!decision.allowed) {
        throw new HttpError(403, "ACCESS_DENIED", "Akses aplikasi ditolak");
      }

      const code = generateCode();
      await deps.repository.createAuthorizationCode({
        codeHash: sha256Hex(code),
        userId: decision.user.id,
        applicationId: decision.application.id,
        ssoSessionId: input.ssoSessionId,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        expiresAt: addMinutes(now(), deps.authorizationCodeTtlMinutes),
      });

      await deps.repository.createAuditLog({
        eventType: "authorization_code_issued",
        result: "success",
        userId: decision.user.id,
        applicationId: decision.application.id,
        sessionId: input.ssoSessionId,
      });

      const redirectUrl = new URL(input.redirectUri);
      redirectUrl.searchParams.set("code", code);
      redirectUrl.searchParams.set("state", input.state);

      return {
        code,
        redirectTo: redirectUrl.toString(),
      };
    },

    async exchangeAuthorizationCode(input) {
      return deps.repository.withTransaction(async (repository) => {
        const code = await repository.findAuthorizationCodeByHash(
          sha256Hex(input.code),
        );
        const currentTime = now();

        if (!code) {
          throw invalidGrant();
        }

        if (code.usedAt) {
          throw invalidGrant("Authorization code sudah digunakan");
        }

        if (code.expiresAt.getTime() <= currentTime.getTime()) {
          throw invalidGrant("Authorization code kedaluwarsa");
        }

        if (code.application.clientId !== input.clientId) {
          throw invalidGrant();
        }

        if (code.redirectUri !== input.redirectUri) {
          throw invalidGrant();
        }

        if (code.codeChallenge !== createPkceChallenge(input.codeVerifier)) {
          throw invalidGrant();
        }

        if (!sessionIsActive(code.ssoSession, currentTime)) {
          throw invalidGrant("Central session tidak valid");
        }

        const consumed = await repository.consumeAuthorizationCode(
          code.id,
          currentTime,
        );
        if (!consumed) {
          throw invalidGrant("Authorization code sudah digunakan");
        }

        const accessToken = generateToken();
        await repository.createAccessToken({
          tokenHash: sha256Hex(accessToken),
          userId: code.userId,
          applicationId: code.applicationId,
          ssoSessionId: code.ssoSessionId,
          expiresAt: addMinutes(currentTime, deps.accessTokenTtlMinutes),
        });

        await repository.createAuditLog({
          eventType: "token_issued",
          result: "success",
          userId: code.userId,
          applicationId: code.applicationId,
          sessionId: code.ssoSessionId,
        });

        return {
          access_token: accessToken,
          token_type: "Bearer" as const,
          expires_in: deps.accessTokenTtlMinutes * 60,
        };
      });
    },

    async getUserInfo(accessToken) {
      if (!accessToken) {
        throw new HttpError(401, "UNAUTHORIZED", "Access token diperlukan");
      }

      const token = await deps.repository.findAccessTokenByHash(
        sha256Hex(accessToken),
      );
      const currentTime = now();

      if (
        !token ||
        token.status !== "active" ||
        token.expiresAt.getTime() <= currentTime.getTime() ||
        !sessionIsActive(token.ssoSession, currentTime) ||
        token.user.status !== "active" ||
        token.application.status !== "active"
      ) {
        throw new HttpError(401, "UNAUTHORIZED", "Access token tidak valid");
      }

      const groups =
        token.groups ?? (await deps.repository.findUserGroups(token.userId));

      return {
        sub: token.user.id,
        name: token.user.name,
        email: token.user.email,
        groups,
        centralSessionId: token.ssoSessionId,
      };
    },
  };
}

export function createPrismaOauthRepository(
  prisma: PrismaClient | Prisma.TransactionClient,
): OauthRepository {
  const repository: OauthRepository = {
    async withTransaction(work) {
      if (!("$transaction" in prisma)) {
        return work(repository);
      }
      return prisma.$transaction((transaction) =>
        work(createPrismaOauthRepository(transaction)),
      );
    },
    async createAuthorizationCode(input) {
      return prisma.authorizationCode.create({
        data: input,
        include: {
          application: true,
          user: true,
          ssoSession: true,
        },
      });
    },

    async findAuthorizationCodeByHash(codeHash) {
      return prisma.authorizationCode.findUnique({
        where: { codeHash },
        include: {
          application: true,
          user: true,
          ssoSession: true,
        },
      });
    },

    async consumeAuthorizationCode(id, usedAt) {
      const result = await prisma.authorizationCode.updateMany({
        where: { id, usedAt: null },
        data: { usedAt },
      });
      return result.count === 1;
    },

    async createAccessToken(input) {
      return prisma.accessToken.create({
        data: input,
        include: {
          application: true,
          user: true,
          ssoSession: true,
        },
      });
    },

    async findAccessTokenByHash(tokenHash) {
      return prisma.accessToken.findUnique({
        where: { tokenHash },
        include: {
          application: true,
          user: true,
          ssoSession: true,
        },
      });
    },

    async findUserGroups(userId) {
      const userGroups = await prisma.userGroup.findMany({
        where: { userId },
        include: { group: true },
      });
      return userGroups.map((userGroup) => userGroup.group.name);
    },

    async createAuditLog(input) {
      await prisma.auditLog.create({
        data: {
          eventType: input.eventType,
          result: input.result,
          userId: input.userId,
          applicationId: input.applicationId,
          sessionId: input.sessionId,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    },
  };

  return repository;
}
