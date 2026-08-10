import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { loadAuthConfig } from "./config.js";
import { authDb } from "./db.js";
import {
  errorHandler,
  notFoundMiddleware,
} from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createAuthRoutes } from "./routes/auth.routes.js";
import { healthRoutes } from "./routes/health.routes.js";
import { createOauthRoutes } from "./routes/oauth.routes.js";
import {
  createAuthService,
  createPrismaAuthRepository,
  type AuthService,
} from "./services/auth.service.js";
import {
  createOauthService,
  createPrismaOauthRepository,
  type OauthService,
} from "./services/oauth.service.js";
import {
  createPolicyService,
  createPrismaPolicyRepository,
} from "./services/policy.service.js";

export interface CreateAuthAppOptions {
  authService?: AuthService;
  oauthService?: OauthService;
}

export function createAuthApp(options: CreateAuthAppOptions = {}) {
  const config = loadAuthConfig();
  const authService =
    options.authService ??
    createAuthService({
      repository: createPrismaAuthRepository(authDb),
      sessionTtlMinutes: config.ssoSessionTtlMinutes,
    });
  const policyService = createPolicyService({
    repository: createPrismaPolicyRepository(authDb),
  });
  const oauthService =
    options.oauthService ??
    createOauthService({
      repository: createPrismaOauthRepository(authDb),
      policyService,
      authorizationCodeTtlMinutes: 5,
      accessTokenTtlMinutes: 30,
    });
  const app = express();

  app.use(
    cors({
      origin: config.allowedWebOrigins,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser(config.cookieSecret));
  app.use(requestIdMiddleware);

  app.use(healthRoutes);
  app.use(createAuthRoutes(authService, config));
  app.use(createOauthRoutes(authService, oauthService, config));

  app.use(notFoundMiddleware);
  app.use(errorHandler);

  return app;
}
