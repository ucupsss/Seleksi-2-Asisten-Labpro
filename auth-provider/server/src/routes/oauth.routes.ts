import { readBearerToken } from "@sso/shared";
import { Router } from "express";
import { z } from "zod";
import type { AuthConfig } from "../config.js";
import { HttpError } from "../errors.js";
import type { AuthService } from "../services/auth.service.js";
import type { OauthService } from "../services/oauth.service.js";

const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  state: z.string().min(1),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal("S256"),
});

const tokenBodySchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_verifier: z.string().min(1),
});

function createLoginRedirect(reqUrl: string, config: AuthConfig) {
  const loginUrl = new URL("/login", config.authWebUrl);
  loginUrl.searchParams.set("returnTo", reqUrl);
  return loginUrl.toString();
}

export function createOauthRoutes(
  authService: AuthService,
  oauthService: OauthService,
  config: AuthConfig,
) {
  const router = Router();

  router.get("/oauth/authorize", async (req, res, next) => {
    try {
      const parsed = authorizeQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        throw new HttpError(
          400,
          "INVALID_REQUEST",
          "Authorization request tidak valid",
        );
      }

      const session = await authService.getCurrentSsoSession(
        req.cookies[config.cookieName],
      );

      if (!session) {
        res.redirect(createLoginRedirect(req.originalUrl, config));
        return;
      }

      const authorization = await oauthService.createAuthorizationCode({
        userId: session.user.id,
        ssoSessionId: session.id,
        clientId: parsed.data.client_id,
        redirectUri: parsed.data.redirect_uri,
        state: parsed.data.state,
        codeChallenge: parsed.data.code_challenge,
      });

      res.redirect(authorization.redirectTo);
    } catch (error) {
      next(error);
    }
  });

  router.post("/oauth/token", async (req, res, next) => {
    try {
      const parsed = tokenBodySchema.safeParse(req.body);

      if (!parsed.success) {
        throw new HttpError(400, "INVALID_REQUEST", "Token request tidak valid");
      }

      const token = await oauthService.exchangeAuthorizationCode({
        code: parsed.data.code,
        clientId: parsed.data.client_id,
        redirectUri: parsed.data.redirect_uri,
        codeVerifier: parsed.data.code_verifier,
      });

      res.json(token);
    } catch (error) {
      next(error);
    }
  });

  router.get("/oauth/userinfo", async (req, res, next) => {
    try {
      const bearerToken =
        readBearerToken(req.header("authorization")) ?? undefined;
      const userInfo = await oauthService.getUserInfo(
        bearerToken,
      );
      res.json(userInfo);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
