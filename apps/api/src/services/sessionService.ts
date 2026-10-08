import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { getAbsoluteSessionTtlSeconds, getIdleTimeoutSeconds } from "../config";
import * as sessionRepository from "../repositories/sessionRepository";
import * as userRepository from "../repositories/userRepository";
import { UnauthorizedError } from "./errors";
import { signAccessToken } from "./tokenService";

export const REFRESH_COOKIE_NAME = "kyvera_refresh";

// ADR 0012: a second tab racing the first can present a secret that was
// valid a moment ago but has already been rotated away by the time its
// request is processed. Within this window, that's treated as a benign
// race (rotate again, don't revoke) rather than reuse. Outside it, the same
// stale secret is treated as an actually-stolen, already-superseded token.
const ROTATION_GRACE_WINDOW_MS = 60_000;

const MAX_USER_AGENT_LENGTH = 512;

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// SHA-256 hex digests are always the same length for both inputs, so this
// never falls back to the non-constant-time length check `timingSafeEqual`
// itself would throw on for mismatched lengths.
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function formatRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

function parseRefreshToken(value: string | undefined): { sessionId: string; secret: string } | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  return { sessionId: value.slice(0, dot), secret: value.slice(dot + 1) };
}

export interface IssuedSession {
  sessionId: string;
  secret: string;
  expiresAt: Date;
}

/** Called on login. Also sweeps this user's own expired/revoked rows first -
 * ADR 0012's chosen moment for the "simple periodic delete" the plan allowed,
 * rather than a background interval this project has no infrastructure for. */
export async function createSession(userId: string, userAgent: string | undefined): Promise<IssuedSession> {
  await sessionRepository.deleteStale();

  const secret = randomSecret();
  const expiresAt = new Date(Date.now() + getAbsoluteSessionTtlSeconds() * 1000);
  const session = await sessionRepository.create({
    user: { connect: { id: userId } },
    tokenHash: hashSecret(secret),
    userAgent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH),
    expiresAt,
  });
  return { sessionId: session.id, secret, expiresAt };
}

export interface RotatedSession extends IssuedSession {
  token: string;
  accessTokenExpiresIn: number;
  idleTimeoutSeconds: number;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    isActive: boolean;
    mustChangePassword: boolean;
    createdAt: Date;
  };
}

// Concurrent refreshes from the same cookie (two tabs firing at once, or one
// tab double-firing) must both succeed, not have the second overwrite the
// first's write and leave a dangling previous-hash neither cookie matches.
// Bounded only as a defensive backstop against a pathological number of
// simultaneous racers - two or three real tabs resolve on the first retry.
const MAX_ROTATE_ATTEMPTS = 5;

/**
 * Validates the presented refresh cookie, rotates it, and mints a fresh
 * access token for the same session (ADR 0012). Three outcomes for the
 * presented secret: it matches the session's current one (ordinary
 * rotation); it matches the *previous* one, within the grace window (a
 * racing second tab - rotate again, don't revoke); or neither (reuse of an
 * already-superseded token - revoke the whole session).
 *
 * The actual rotation is a compare-and-swap (`rotateIfCurrent`), conditioned
 * on the `tokenHash` this call read. If another concurrent call already
 * rotated the session out from under it, the write affects zero rows; this
 * re-reads the (now fresher) row and retries the same three-way check
 * against it, rather than proceeding to write stale data or treating a lost
 * race as reuse.
 */
export async function rotateSession(cookieValue: string | undefined): Promise<RotatedSession> {
  const parsed = parseRefreshToken(cookieValue);
  if (!parsed) {
    throw new UnauthorizedError("No valid refresh token");
  }

  let session = await sessionRepository.findById(parsed.sessionId);

  for (let attempt = 0; attempt < MAX_ROTATE_ATTEMPTS; attempt++) {
    if (!session || session.revokedAt) {
      throw new UnauthorizedError("Session has been revoked");
    }

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      throw new UnauthorizedError("Session has expired");
    }
    if (now - session.lastUsedAt.getTime() > getIdleTimeoutSeconds() * 1000) {
      // Deliberately not revoked: lastUsedAt stays frozen, so every later
      // attempt keeps failing the same way without needing an explicit flag.
      throw new UnauthorizedError("Session timed out from inactivity");
    }

    const presentedHash = hashSecret(parsed.secret);
    const isCurrent = hashesMatch(presentedHash, session.tokenHash);
    const isRecentlySuperseded =
      !isCurrent &&
      session.previousTokenHash !== null &&
      session.rotatedAt !== null &&
      now - session.rotatedAt.getTime() <= ROTATION_GRACE_WINDOW_MS &&
      hashesMatch(presentedHash, session.previousTokenHash);

    if (!isCurrent && !isRecentlySuperseded) {
      await sessionRepository.revoke(session.id);
      throw new UnauthorizedError("Refresh token reuse detected");
    }

    const user = await userRepository.findSafeById(session.userId);
    if (!user || !user.isActive || user.id !== session.userId) {
      throw new UnauthorizedError("User is deactivated");
    }

    const newSecret = randomSecret();
    const rotatedAt = new Date(now);
    const written = await sessionRepository.rotateIfCurrent(session.id, session.tokenHash, {
      tokenHash: hashSecret(newSecret),
      previousTokenHash: session.tokenHash,
      rotatedAt,
      lastUsedAt: rotatedAt,
    });

    if (written.count === 1) {
      const { token, expiresIn } = signAccessToken({ id: user.id, role: user.role }, session.id);
      return {
        sessionId: session.id,
        secret: newSecret,
        expiresAt: session.expiresAt,
        token,
        accessTokenExpiresIn: expiresIn,
        idleTimeoutSeconds: getIdleTimeoutSeconds(),
        user,
      };
    }

    // Lost the race: a concurrent call rotated this session between our
    // read and our write. Re-read and loop - the presented secret is
    // evaluated fresh against the new current/previous hashes, exactly as
    // it would be on any other request.
    session = await sessionRepository.findById(parsed.sessionId);
  }

  throw new UnauthorizedError("Could not refresh session - please try again");
}

export function revokeAllForUser(userId: string) {
  return sessionRepository.revokeAllForUser(userId);
}

/**
 * Revokes the session identified by the presented refresh cookie - but only
 * if the secret is one we recognise (the session's current one, or its
 * immediately-previous one). A cookie that doesn't match either is already
 * meaningless; logout has nothing useful to do with it and isn't the place
 * to run reuse-detection's revoke-the-whole-session response (that's for a
 * *refresh* attempt, not a courtesy logout call). Always resolves - logout
 * from the client's perspective succeeds whether or not there was anything
 * real to revoke.
 */
export async function logout(cookieValue: string | undefined): Promise<void> {
  const parsed = parseRefreshToken(cookieValue);
  if (!parsed) return;

  const session = await sessionRepository.findById(parsed.sessionId);
  if (!session || session.revokedAt) return;

  const presentedHash = hashSecret(parsed.secret);
  const recognised =
    hashesMatch(presentedHash, session.tokenHash) ||
    (session.previousTokenHash !== null && hashesMatch(presentedHash, session.previousTokenHash));

  if (recognised) {
    await sessionRepository.revoke(session.id);
  }
}

/** ADR 0012: the access-token-side half of immediate revocation. Loaded by
 * `authService.resolveActor` on every authenticated request. */
export async function assertSessionValid(sessionId: string, userId: string): Promise<void> {
  const session = await sessionRepository.findValidityById(sessionId);
  if (!session || session.userId !== userId || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError("Session has been revoked");
  }
}
