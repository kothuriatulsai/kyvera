import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { getAccessTokenTtlSeconds, getJwtSecret } from "../config";
import { UnauthorizedError } from "./errors";

/**
 * Who is making a request, as proven by a verified token. Deliberately just
 * identity and role: anything that can change between logins (assignments,
 * ownership) is looked up per request, never baked into a token where it would
 * go stale.
 */
export interface Actor {
  id: string;
  role: UserRole;
}

/**
 * `verifyAccessToken`'s result: an `Actor` plus when the token was issued and
 * which session minted it. `authenticate` passes both on to `resolveActor`,
 * which rejects a token issued before the user's last password reset (ADR
 * 0011) or whose session has since been revoked/expired (ADR 0012) - kept
 * separate from `Actor` so neither leaks into `req.actor`, which nothing past
 * authentication needs them for.
 */
export interface VerifiedAccessToken extends Actor {
  /** Milliseconds since the epoch - see `signAccessToken`'s `iatMs` claim. */
  issuedAt: number;
  /** The `UserSession` this access token was minted for (ADR 0012's `sid`
   * claim) - lets `authenticate` reject it the instant that session is
   * revoked, rather than waiting out its own short lifetime. */
  sessionId: string;
}

export interface IssuedToken {
  token: string;
  /** Lifetime in seconds. */
  expiresIn: number;
}

// Pinned on both sign and verify; never let the token choose its own algorithm.
const ALGORITHM = "HS256";

export function signAccessToken(actor: Actor, sessionId: string): IssuedToken {
  const expiresIn = getAccessTokenTtlSeconds();
  const token = jwt.sign(
    {
      role: actor.role,
      // The standard `iat` claim is whole seconds (JWT spec), too coarse to
      // reliably order against a password reset that can land in the same
      // second in practice (e.g. a test logging in and resetting back to
      // back) - this custom claim is millisecond-precision, just for that
      // comparison in `resolveActor` (ADR 0011).
      iatMs: Date.now(),
      // ADR 0012: makes logout (and a future "log out everywhere") take
      // effect immediately instead of waiting for this token to expire on
      // its own.
      sid: sessionId,
    },
    getJwtSecret(),
    {
      algorithm: ALGORITHM,
      subject: actor.id,
      expiresIn,
    },
  );
  return { token, expiresIn };
}

export function verifyAccessToken(token: string): VerifiedAccessToken {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: [ALGORITHM] });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("Token has expired");
    }
    throw new UnauthorizedError("Invalid token");
  }

  // A correctly signed token still has to carry the claims we expect.
  if (
    typeof payload === "string" ||
    typeof payload.sub !== "string" ||
    payload.sub === "" ||
    typeof payload.iatMs !== "number" ||
    typeof payload.sid !== "string" ||
    payload.sid === "" ||
    !Object.values(UserRole).includes(payload.role as UserRole)
  ) {
    throw new UnauthorizedError("Invalid token");
  }

  return {
    id: payload.sub,
    role: payload.role as UserRole,
    issuedAt: payload.iatMs,
    sessionId: payload.sid,
  };
}
