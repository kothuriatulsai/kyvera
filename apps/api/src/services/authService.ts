import type { UserRole } from "@prisma/client";
import * as userRepository from "../repositories/userRepository";
import { UnauthorizedError } from "./errors";
import { verifyAgainstDummy, verifyPassword } from "./passwordService";
import { signAccessToken, type Actor } from "./tokenService";
import { createUser, normalizeEmail } from "./userService";

// Public registration must never be a way to mint a privileged account, so it
// always creates the least-privileged role. Granting any other role is user
// management, which ADR 0004 reserves for admins.
const REGISTRATION_ROLE: UserRole = "ENGINEER";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export function register(input: RegisterInput) {
  return createUser({ ...input, role: REGISTRATION_ROLE });
}

export async function login(input: LoginInput) {
  const user = await userRepository.findByEmail(normalizeEmail(input.email));

  // Same message and (roughly) the same time for "no such user" and "wrong
  // password", so the endpoint can't be used to discover registered emails.
  if (!user) {
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
 */
export async function resolveActor(claims: Actor): Promise<Actor> {
  const user = await userRepository.findSafeById(claims.id);
  if (!user) {
    throw new UnauthorizedError("User no longer exists");
  }
  return { id: user.id, role: user.role };
}

export async function getCurrentUser(actor: Actor) {
  const user = await userRepository.findSafeById(actor.id);
  if (!user) {
    // A correctly signed token for a user that has since been deleted.
    throw new UnauthorizedError("User no longer exists");
  }
  return user;
}
