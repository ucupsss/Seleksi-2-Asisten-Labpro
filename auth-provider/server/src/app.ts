import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { loadAuthConfig, type AuthConfig } from "./config.js";
import { authDb } from "./db.js";
import {
  errorHandler,
  notFoundMiddleware,
} from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createRequireAdministrator } from "./middleware/require-administrator.js";
import { createAdminRoutes } from "./routes/admin.routes.js";
import { createAuthRoutes } from "./routes/auth.routes.js";
import {
  createDefaultReadinessChecks,
  createHealthRoutes,
  type ReadinessChecks,
} from "./routes/health.routes.js";
import { createOauthRoutes } from "./routes/oauth.routes.js";
import {
  createAdminService,
  createPrismaAdminRepository,
  type AdminService,
} from "./services/admin.service.js";
import {
  createAuthService,
  createPrismaAuthRepository,
  type AuthService,
} from "./services/auth.service.js";
import {
  createEventService,
  createPrismaEventRepository,
} from "./services/event.service.js";
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
  config?: AuthConfig;
  authService?: AuthService;
  oauthService?: OauthService;
  adminService?: AdminService;
  readinessChecks?: ReadinessChecks;
}

export function createAuthApp(options: CreateAuthAppOptions = {}) {
  const config = options.config ?? loadAuthConfig();
  const eventService = createEventService({
    repository: createPrismaEventRepository(authDb),
  });
  const authService =
    options.authService ??
    createAuthService({
      repository: createPrismaAuthRepository(authDb),
      eventService,
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
  const adminService =
    options.adminService ??
    createAdminService({
      repository: createPrismaAdminRepository(authDb),
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

  app.use(
    createHealthRoutes(
      options.readinessChecks ?? createDefaultReadinessChecks(config),
      config.healthReadinessTimeoutMs,
    ),
  );
  app.use(createAuthRoutes(authService, config));
  app.use(createOauthRoutes(authService, oauthService, config));
  const requireAdministrator = createRequireAdministrator(authService, config);
  app.get("/admin/session", requireAdministrator, (_req, res) => {
    res.json({ session: res.locals.administratorSession });
  });
  app.use("/admin", requireAdministrator);
  app.use(createAdminRoutes(adminService));

  app.use(notFoundMiddleware);
  app.use(errorHandler);

  return app;
}
