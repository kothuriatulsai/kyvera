import argon2 from "argon2";

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
