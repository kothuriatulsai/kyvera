import * as userRepository from "../repositories/userRepository";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { assertPasswordPolicy, hashPassword, verifyAgainstDummy, verifyPassword } from "./passwordService";
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

export async function login(input: LoginInput) {
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

  const { token, expiresIn } = signAccessToken({ id: user.id, role: user.role });

  return {
    token,
    tokenType: "Bearer" as const,
    expiresIn,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    },
  };
}

/**
 * Turns verified token claims into the actor for this request. The token proves
 * *who* is calling; the role is read fresh from the database, not trusted from
 * the token. Authorization now depends on the role, so a demoted admin must
 * stop being an admin immediately rather than when their token expires, and a
 * deleted user's token must stop working.
 *
 * Also rejects a deactivated user (ADR 0010/0011), and a token issued before
 * the user's most recent password change (ADR 0011) - `passwordChangedAt`
 * null means "never changed since creation," so every token for that user is
 * fine. `mustChangePassword` is passed through (not enforced here) for
 * `requirePasswordChanged` to act on, once `req.actor` is set.
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
 * proving they're still them, not an admin acting on their behalf.
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
  return userRepository.updatePassword(actorId, passwordHash, false);
}
