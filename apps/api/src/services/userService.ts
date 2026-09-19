import { Prisma, type UserRole } from "@prisma/client";
import * as userRepository from "../repositories/userRepository";
import { ConflictError, ValidationError } from "./errors";
import { assertPasswordPolicy, hashPassword } from "./passwordService";

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The one place a user row gets created, so every path (public registration
 * today, admin user management once ADR 0004 is implemented) hashes the
 * password and normalises the email the same way. The *caller* decides the
 * role; this function doesn't decide who may ask for which one.
 */
export async function createUser(input: CreateUserInput) {
  const email = normalizeEmail(input.email);
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError("email must be a valid email address");
  }
  assertPasswordPolicy(input.password);

  if (await userRepository.findByEmail(email)) {
    throw new ConflictError("A user with that email already exists");
  }

  const passwordHash = await hashPassword(input.password);

  try {
    return await userRepository.create({
      name: input.name.trim(),
      email,
      role: input.role,
      passwordHash,
    });
  } catch (err) {
    // Lost a race with a concurrent registration of the same email.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("A user with that email already exists");
    }
    throw err;
  }
}
