import type { Request, Response } from "express";
import { getAllowedOrigins } from "../config";
import { requireActor } from "../middleware/authenticate";
import * as authService from "../services/authService";
import { ForbiddenError } from "../services/errors";
import * as sessionService from "../services/sessionService";
import { asyncHandler } from "./asyncHandler";
import { requireString } from "./requestParsing";

const { REFRESH_COOKIE_NAME, formatRefreshToken } = sessionService;

const REFRESH_COOKIE_PATH = "/auth";

function refreshCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // Plain http:// in local dev - a Secure cookie would just never be sent.
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  };
}

function setRefreshCookie(res: Response, sessionId: string, secret: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, formatRefreshToken(sessionId, secret), refreshCookieOptions(expiresAt));
}

function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[REFRESH_COOKIE_NAME];
}

/**
 * CSRF guard for the two cookie-authenticated endpoints (ADR 0012).
 * SameSite=Strict already stops the cookie attaching to a genuinely
 * cross-site request in most browsers; this is a second, explicit layer -
 * a request that somehow still carries the cookie but isn't coming from a
 * page this API serves to is refused regardless.
 */
function assertAllowedOrigin(req: Request): void {
  const origin = req.headers.origin;
  if (!origin || !getAllowedOrigins().includes(origin)) {
    throw new ForbiddenError("Origin not allowed");
  }
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const result = await authService.login(
    { email: requireString(body, "email"), password: requireString(body, "password") },
    req.headers["user-agent"],
  );
  setRefreshCookie(res, result.session.sessionId, result.session.secret, result.session.expiresAt);
  res.json({
    token: result.token,
    tokenType: result.tokenType,
    expiresIn: result.expiresIn,
    idleTimeoutSeconds: result.idleTimeoutSeconds,
    user: result.user,
  });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getCurrentUser(requireActor(req));
  res.json(user);
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const body = req.body as Record<string, unknown>;
  const user = await authService.changePassword(
    actor.id,
    requireString(body, "currentPassword"),
    requireString(body, "newPassword"),
  );
  res.json(user);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  assertAllowedOrigin(req);
  const result = await sessionService.rotateSession(readRefreshCookie(req));
  setRefreshCookie(res, result.sessionId, result.secret, result.expiresAt);
  res.json({
    token: result.token,
    tokenType: "Bearer" as const,
    expiresIn: result.accessTokenExpiresIn,
    idleTimeoutSeconds: result.idleTimeoutSeconds,
    user: result.user,
  });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  assertAllowedOrigin(req);
  await sessionService.logout(readRefreshCookie(req));
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  res.status(204).send();
});
