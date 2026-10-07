import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../services/errors";

/**
 * ADR 0011: once an admin reset forces a password change, every route
 * mounted after this in routes/index.ts is blocked until the user sets a
 * real password of their own. `GET /auth/me` and `POST /auth/change-password`
 * are mounted earlier, inside authRoutes, each authenticating directly - so
 * they never reach this middleware at all, not because of an exemption list
 * here.
 *
 * Must be mounted after `authenticate`, which sets `req.mustChangePassword`.
 */
export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction) {
  if (req.mustChangePassword) {
    next(new ForbiddenError("You must change your password before continuing"));
    return;
  }
  next();
}
