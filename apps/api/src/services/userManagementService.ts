import { Prisma, type UserRole } from "@prisma/client";
import * as userRepository from "../repositories/userRepository";
import { normalizeEmail } from "./authService";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { generateTemporaryPassword, hashPassword } from "./passwordService";
import * as sessionService from "./sessionService";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export interface CreateUserInput {
  name: string;
  email: string;
  role: UserRole;
}

/**
 * ADR 0010/0011: the only way a user row gets created now. Admin-only -
 * enforced by the route, not here. Generates a one-time temporary password
 * the same way `resetPassword` does, rather than taking one from the admin -
 * an admin-chosen password would mean the admin knows a password the new
 * user might reuse elsewhere. Sets `mustChangePassword`, same as a reset,
 * and stamps `passwordChangedAt` at creation (not just on reset), so every
 * account's "is this token older than the last known password" check has a
 * real value to compare against, never null except for the handful of users
 * seeded before this feature existed.
 */
export async function createUser(input: CreateUserInput) {
  const email = normalizeEmail(input.email);
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError("email must be a valid email address");
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    const user = await userRepository.create({
      name: input.name.trim(),
      email,
      role: input.role,
      passwordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: true,
    });
    return { user, temporaryPassword };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("A user with that email already exists");
    }
    throw err;
  }
}

export function listUsers() {
  return userRepository.findMany();
}

async function requireUser(id: string) {
  const user = await userRepository.findSafeById(id);
  if (!user) {
    throw new NotFoundError(`User ${id} not found`);
  }
  return user;
}

/**
 * The system must always have someone who can manage users: never let the
 * active-admin count reach zero. Reachable in practice only through
 * `changeRole` (an admin demoting themselves while they're the only one
 * active) - see the comment on `deactivateUser`'s call for why that one is
 * currently just a safety net.
 */
async function assertNotLastActiveAdmin(user: { role: UserRole; isActive: boolean }) {
  if (user.role === "ADMIN" && user.isActive && (await userRepository.countActiveAdmins()) <= 1) {
    throw new ConflictError("Cannot remove the last active admin");
  }
}

export async function changeRole(targetId: string, role: UserRole) {
  const user = await requireUser(targetId);
  if (role !== "ADMIN") {
    await assertNotLastActiveAdmin(user);
  }
  return userRepository.updateRole(targetId, role);
}

export async function deactivateUser(actorId: string, targetId: string) {
  if (actorId === targetId) {
    throw new ForbiddenError("You may not deactivate your own account");
  }
  const user = await requireUser(targetId);
  // Defense in depth, not currently reachable: the actor must themselves be
  // an active admin to get past `requireRole("ADMIN")`, so whenever actor !=
  // target, at least one active admin (the actor) always remains after this
  // - the only way deactivation could zero out admins is self-deactivation,
  // already blocked above. Kept in case that changes (e.g. a future "admin
  // deactivates on someone's behalf" path that doesn't require being active).
  await assertNotLastActiveAdmin(user);
  const deactivated = await userRepository.setActive(targetId, false);
  // ADR 0012: ends every session immediately, not just the access tokens
  // already outstanding - resolveActor's isActive check would eventually
  // catch those too, but a refresh could otherwise still mint a fresh one.
  await sessionService.revokeAllForUser(targetId);
  return deactivated;
}

export async function reactivateUser(targetId: string) {
  await requireUser(targetId);
  return userRepository.setActive(targetId, true);
}

/**
 * Generates a one-time temporary password (ADR 0011) rather than taking one
 * from the admin - an admin-chosen password would mean the admin knows the
 * user's real password, not just a placeholder they're forced to replace.
 * Returned once, here, in `temporaryPassword`; nothing persists it in
 * plaintext anywhere, and there's no way to retrieve it again after this
 * call returns - only another reset.
 */
export async function resetPassword(targetId: string) {
  await requireUser(targetId);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const user = await userRepository.updatePassword(targetId, passwordHash, true);
  // ADR 0012: same reasoning as deactivation - a reset must end every
  // session logged in under the old password immediately.
  await sessionService.revokeAllForUser(targetId);
  return { user, temporaryPassword };
}
