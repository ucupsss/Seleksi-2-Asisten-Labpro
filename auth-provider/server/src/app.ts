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
import {
  createAuthService,
  createPrismaAuthRepository,
  type AuthService,
} from "./services/auth.service.js";

export interface CreateAuthAppOptions {
  authService?: AuthService;
}

export function createAuthApp(options: CreateAuthAppOptions = {}) {
  const config = loadAuthConfig();
  const authService =
    options.authService ??
    createAuthService({
      repository: createPrismaAuthRepository(authDb),
      sessionTtlMinutes: config.ssoSessionTtlMinutes,
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

  app.use(notFoundMiddleware);
  app.use(errorHandler);

  return app;
}
