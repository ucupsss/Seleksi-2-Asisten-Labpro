import type { RequestHandler } from "express";
import type { AuthConfig } from "../config.js";
import { HttpError } from "../errors.js";
import type {
  AuthService,
  SsoSessionContext,
} from "../services/auth.service.js";

export interface AdministratorLocals {
  administratorSession: SsoSessionContext;
}

export function createRequireAdministrator(
  authService: Pick<AuthService, "getCurrentSsoSession">,
  config: Pick<AuthConfig, "cookieName">,
): RequestHandler<Record<string, string>, unknown, unknown, unknown, AdministratorLocals> {
  return async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const session = await authService.getCurrentSsoSession(
        req.cookies[config.cookieName],
      );

      if (!session) {
        throw new HttpError(401, "UNAUTHORIZED", "Autentikasi diperlukan");
      }

      if (!session.user.groups.includes("administrators")) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Akses administrator diperlukan",
        );
      }

      res.locals.administratorSession = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}
