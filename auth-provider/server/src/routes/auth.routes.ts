import { Router } from "express";
import { z } from "zod";
import type { AuthConfig } from "../config.js";
import { HttpError } from "../errors.js";
import type { AuthService } from "../services/auth.service.js";

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function createAuthRoutes(authService: AuthService, config: AuthConfig) {
  const router = Router();

  router.post("/auth/login", async (req, res, next) => {
    try {
      const parsed = loginBodySchema.safeParse(req.body);

      if (!parsed.success) {
        throw new HttpError(
          400,
          "INVALID_REQUEST",
          "Payload login tidak valid",
        );
      }

      const result = await authService.loginWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
        ipAddress: req.ip,
        userAgent: req.header("user-agent"),
      });

      res.cookie(config.cookieName, result.sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        expires: result.expiresAt,
      });
      res.json({ user: result.user });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/logout", async (req, res, next) => {
    try {
      await authService.logout(req.cookies[config.cookieName]);
      res.clearCookie(config.cookieName, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
