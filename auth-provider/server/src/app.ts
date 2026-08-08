import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { loadAuthConfig } from "./config.js";
import {
  errorHandler,
  notFoundMiddleware,
} from "./middleware/error-handler.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { healthRoutes } from "./routes/health.routes.js";

export function createAuthApp() {
  const config = loadAuthConfig();
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

  app.use(notFoundMiddleware);
  app.use(errorHandler);

  return app;
}
