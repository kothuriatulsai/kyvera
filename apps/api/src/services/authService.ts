import { getIdleTimeoutSeconds } from "../config";
import * as userRepository from "../repositories/userRepository";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { assertPasswordPolicy, hashPassword, verifyAgainstDummy, verifyPassword } from "./passwordService";
import * as sessionService from "./sessionService";
import { signAccessToken, type Actor, type VerifiedAccessToken } from "./tokenService";

export interface ResolvedActor extends Actor {
  mustChangePassword: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function login(input: LoginInput, userAgent: string | undefined) {
  const user = await userRepository.findByEmail(normalizeEmail(input.email));

  // Same message and (roughly) the same time for "no such user", "wrong
  // password" and "deactivated", so none of the three is distinguishable
  // from the others (ADR 0011 extends this to isActive, not just email
  // enumeration).
  if (!user || !user.isActive) {
    await verifyAgainstDummy(input.password);
    throw new UnauthorizedError("Invalid email or password");
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new UnauthorizedError("Invalid email or password");
  }

  // ADR 0012: a refresh-token session alongside the access token, so a page
  // reload doesn't log the user out.
  const session = await sessionService.createSession(user.id, userAgent);
  const { token, expiresIn } = signAccessToken({ id: user.id, role: user.role }, session.sessionId);

  return {
    token,
    tokenType: "Bearer" as const,
    expiresIn,
    idleTimeoutSeconds: getIdleTimeoutSeconds(),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    },
    // Not part of the JSON response - the controller pulls this out to set
    // the refresh cookie and must not let it leak into res.json(...).
    session,
  };
}

/**
 * Turns verified token claims into the actor for this request. The token proves
 * *who* is calling; the role is read fresh from the database, not trusted from
 * the token. Authorization now depends on the role, so a demoted admin must
 * stop being an admin immediately rather than when their token expires, and a
 * deleted user's token must stop working.
 *
 * Also rejects a deactivated user (ADR 0010/0011), a token issued before the
 * user's most recent password change (ADR 0011), and a token whose session
 * has since been revoked or expired (ADR 0012) - this last one is what makes
 * logout (and a future "log out everywhere") take effect immediately, rather
 * than waiting out the access token's own short lifetime.
 */
export async function resolveActor(claims: VerifiedAccessToken): Promise<ResolvedActor> {
  const user = await userRepository.findAuthSnapshotById(claims.id);
  if (!user) {
    throw new UnauthorizedError("User no longer exists");
  }
  if (!user.isActive) {
    throw new UnauthorizedError("User is deactivated");
  }
  if (user.passwordChangedAt && claims.issuedAt < user.passwordChangedAt.getTime()) {
    throw new UnauthorizedError("Token is no longer valid — please log in again");
  }
  await sessionService.assertSessionValid(claims.sessionId, claims.id);
  return { id: user.id, role: user.role, mustChangePassword: user.mustChangePassword };
}

export async function getCurrentUser(actor: Actor) {
  const user = await userRepository.findSafeById(actor.id);
  if (!user) {
    // A correctly signed token for a user that has since been deleted.
    throw new UnauthorizedError("User no longer exists");
  }
  return user;
}

/**
 * Self-service password change (ADR 0011) - the only way to clear
 * `mustChangePassword` once an admin reset sets it. Requires the current
 * password, unlike an admin's reset, since this is the account holder
 * proving they're still them, not an admin acting on their behalf. Revokes
 * every session (ADR 0012), same as an admin reset or deactivation - a
 * password change must end every session logged in under the old one, not
 * just leave them to expire on their own schedule.
 */
export async function changePassword(actorId: string, currentPassword: string, newPassword: string) {
  const user = await userRepository.findById(actorId);
  if (!user) {
    throw new UnauthorizedError("User no longer exists");
  }
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new ForbiddenError("Current password is incorrect");
  }
  assertPasswordPolicy(newPassword);
  const passwordHash = await hashPassword(newPassword);
  const updated = await userRepository.updatePassword(actorId, passwordHash, false);
  await sessionService.revokeAllForUser(actorId);
  return updated;
}
