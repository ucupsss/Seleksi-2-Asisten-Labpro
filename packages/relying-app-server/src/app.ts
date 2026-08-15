import { createHash } from "node:crypto";
import { buildAuthorizeUrl, createStandardError, randomToken } from "@sso/shared";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { z } from "zod";
import type { RelyingAppConfig } from "./config.js";
import { HttpError } from "./errors.js";
import {
  createLocalSessionService,
  type LocalSessionService,
} from "./local-session.service.js";
import { createOAuthClient, type OAuthClient } from "./oauth-client.js";
import { createPrismaLocalSessionRepository } from "./prisma-local-session.repository.js";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const internalLogoutBodySchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  userId: z.string().min(1),
  centralSessionId: z.string().min(1),
  applicationId: z.string().min(1).nullable().optional(),
  appKey: z.string().min(1).nullable().optional(),
  reason: z.string().min(1),
});

export interface CreateAppServerDependencies {
  prisma?: Parameters<typeof createPrismaLocalSessionRepository>[0];
  oauthClient?: OAuthClient;
  localSessionService?: LocalSessionService;
  generateState?: () => string;
  generatePkceVerifier?: () => string;
}

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    maxAge: maxAgeMs,
  };
}

function clearCookie(res: express.Response, name: string) {
  res.clearCookie(name, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
  });
}

function createRequestId() {
  return randomToken(8);
}

function serializeSessionView(view: Awaited<ReturnType<LocalSessionService["getCurrentSession"]>>) {
  if (view.status === "anonymous") {
    return view;
  }

  return {
    ...view,
    session: {
      ...view.session,
      createdAt: view.session.createdAt.toISOString(),
      expiresAt: view.session.expiresAt.toISOString(),
    },
  };
}

export function createAppServer(
  config: RelyingAppConfig,
  deps: CreateAppServerDependencies = {},
) {
  if (!deps.localSessionService && !deps.prisma) {
    throw new Error("Prisma client is required when localSessionService is not provided");
  }

  const oauthClient = deps.oauthClient ?? createOAuthClient(config.authBaseUrl);
  const localSessionService =
    deps.localSessionService ??
    createLocalSessionService({
      appKey: config.appKey,
      repository: createPrismaLocalSessionRepository(deps.prisma!),
      sessionTtlMinutes: config.localSessionTtlMinutes,
    });
  const generateState = deps.generateState ?? (() => randomToken(24));
  const generatePkceVerifier =
    deps.generatePkceVerifier ?? (() => randomToken(32));
  const pendingCookieMaxAgeMs = config.pendingLoginTtlMinutes * 60 * 1000;
  const localSessionCookieMaxAgeMs = config.localSessionTtlMinutes * 60 * 1000;
  const app = express();

  app.use(cors({ origin: config.allowedWebOrigins, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      appKey: config.appKey,
      appName: config.appName,
    });
  });

  app.post("/login/start", async (_req, res, next) => {
    try {
      const state = generateState();
      const codeVerifier = generatePkceVerifier();
      const redirectTo = buildAuthorizeUrl({
        authBaseUrl: config.authPublicBaseUrl ?? config.authBaseUrl,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        state,
        codeChallenge: pkceChallenge(codeVerifier),
      });

      res.cookie("oauth_state", state, cookieOptions(pendingCookieMaxAgeMs));
      res.cookie(
        "pkce_verifier",
        codeVerifier,
        cookieOptions(pendingCookieMaxAgeMs),
      );
      res.json({ redirectTo });
    } catch (error) {
      next(error);
    }
  });

  app.get("/auth/callback", async (req, res, next) => {
    try {
      const parsed = callbackQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST", "Callback SSO tidak valid");
      }

      if (
        !req.cookies.oauth_state ||
        !req.cookies.pkce_verifier ||
        req.cookies.oauth_state !== parsed.data.state
      ) {
        throw new HttpError(400, "INVALID_REQUEST", "State SSO tidak valid");
      }

      const token = await oauthClient.exchangeCode({
        code: parsed.data.code,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        codeVerifier: req.cookies.pkce_verifier,
      });
      const userInfo = await oauthClient.getUserInfo(token.access_token);
      const localSession =
        await localSessionService.createSessionFromUserInfo(userInfo);

      clearCookie(res, "oauth_state");
      clearCookie(res, "pkce_verifier");
      res.cookie(
        config.localSessionCookieName,
        localSession.sessionToken,
        cookieOptions(localSessionCookieMaxAgeMs),
      );
      res.redirect(config.webHomeUrl);
    } catch (error) {
      next(error);
    }
  });

  app.get("/session", async (req, res, next) => {
    try {
      const view = await localSessionService.getCurrentSession(
        req.cookies[config.localSessionCookieName],
      );
      res.json(serializeSessionView(view));
    } catch (error) {
      next(error);
    }
  });

  app.post("/logout", async (req, res, next) => {
    try {
      await localSessionService.logout(req.cookies[config.localSessionCookieName]);
      clearCookie(res, config.localSessionCookieName);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/internal/logout", async (req, res, next) => {
    try {
      if (req.header("x-internal-secret") !== config.internalSecret) {
        throw new HttpError(401, "UNAUTHORIZED", "Internal secret tidak valid");
      }

      const parsed = internalLogoutBodySchema.safeParse(req.body);

      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST", "Event logout tidak valid");
      }

      const result = await localSessionService.processInternalLogout({
        eventId: parsed.data.eventId,
        eventType: parsed.data.eventType,
        externalUserId: parsed.data.userId,
        centralSessionId: parsed.data.centralSessionId,
        appKey: parsed.data.appKey,
        reason: parsed.data.reason,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, _res, next) => {
    next(new HttpError(404, "NOT_FOUND", "Resource tidak ditemukan"));
  });

  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const requestId = createRequestId();

      if (error instanceof HttpError) {
        res
          .status(error.status)
          .json(createStandardError(error.code, error.message, requestId));
        return;
      }

      res
        .status(500)
        .json(
          createStandardError(
            "INTERNAL_ERROR",
            "Terjadi kesalahan pada server",
            requestId,
          ),
        );
    },
  );

  return app;
}
