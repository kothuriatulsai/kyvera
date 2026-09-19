import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../services/errors";
import { verifyAccessToken, type Actor } from "../services/tokenService";

/**
 * Proves who is calling: verifies the bearer token and attaches the decoded
 * actor as `req.actor`. It is "must be logged in" and nothing more — it makes
 * no decision about what that actor may do (roles, ownership and assignments
 * are enforced in the service layer, per ADR 0004).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) {
    next(new UnauthorizedError("Authentication required"));
    return;
  }

  const [scheme, token, ...rest] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer" || !token || rest.length > 0) {
    next(new UnauthorizedError("Authorization header must be in the form 'Bearer <token>'"));
    return;
  }

  try {
    req.actor = verifyAccessToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

/** For handlers mounted behind `authenticate`; narrows `req.actor` to defined. */
export function requireActor(req: Request): Actor {
  if (!req.actor) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.actor;
}
