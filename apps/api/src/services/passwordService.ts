import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { ValidationError } from "./errors";

const MIN_PASSWORD_LENGTH = 8;
// Bounds the work a single request can make the server do; argon2 has no
// 72-byte truncation like bcrypt, so this is about abuse, not correctness.
const MAX_PASSWORD_LENGTH = 128;

// Used wherever a human types a password the server didn't choose: a
// temporary password on user creation, and a user's own change-password
// (ADR 0011). Not used for an admin reset's temporary password - that one is
// generated below, already guaranteed to fit this policy.
export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new ValidationError(`password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
}

// A one-time temporary password for an admin's reset (ADR 0011) - the admin
// never chooses it, so there's nothing to validate against assertPasswordPolicy.
// 16 URL-safe characters (12 random bytes, base64url): well within the policy
// above and safe to display as plain text in the UI.
export function generateTemporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}

// argon2id with the library's defaults (memory-hard; OWASP's first choice).
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function isArgon2Hash(value: string): boolean {
  return value.startsWith("$argon2");
}

/**
 * A stored value that isn't a valid hash (for example the plain-text
 * placeholder the seed used before auth existed) is simply a failed login, not
 * an error — argon2 would otherwise throw on it and surface as a 500.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same time a real verification would. Login calls this for an
 * unknown email so response time doesn't reveal which emails are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-account-password");
  await verifyPassword(await dummyHash, password);
}
