import { Prisma, type UserRole } from "@prisma/client";
import * as userRepository from "../repositories/userRepository";
import { normalizeEmail } from "./authService";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { assertPasswordPolicy, hashPassword } from "./passwordService";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export interface CreateUserInput {
  name: string;
  email: string;
  role: UserRole;
  temporaryPassword: string;
}

/**
 * ADR 0010/0011: the only way a user row gets created now. Admin-only -
 * enforced by the route, not here. Stamps passwordChangedAt at creation (not
 * just on reset), so every account's "is this token older than the last
 * known password" check has a real value to compare against, never null
 * except for the handful of users seeded before this feature existed.
 */
export async function createUser(input: CreateUserInput) {
  const email = normalizeEmail(input.email);
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError("email must be a valid email address");
  }
  assertPasswordPolicy(input.temporaryPassword);

  const passwordHash = await hashPassword(input.temporaryPassword);

  try {
    return await userRepository.create({
      name: input.name.trim(),
      email,
      role: input.role,
      passwordHash,
      passwordChangedAt: new Date(),
    });
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
  return userRepository.setActive(targetId, false);
}

export async function reactivateUser(targetId: string) {
  await requireUser(targetId);
  return userRepository.setActive(targetId, true);
}

export async function resetPassword(targetId: string, newPassword: string) {
  await requireUser(targetId);
  assertPasswordPolicy(newPassword);
  const passwordHash = await hashPassword(newPassword);
  return userRepository.updatePassword(targetId, passwordHash);
}
