const MIN_JWT_SECRET_LENGTH = 32;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Read lazily (not at import time) so tests and tooling can import the app
 * without a secret, but validated by `assertAuthConfig` at startup so a
 * misconfigured deployment fails on boot rather than on the first login.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set — see apps/api/.env.example");
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }
  return secret;
}

export function getAccessTokenTtlSeconds(): number {
  const raw = process.env.JWT_EXPIRES_IN_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;

  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new Error("JWT_EXPIRES_IN_SECONDS must be a positive integer");
  }
  return seconds;
}

export function assertAuthConfig(): void {
  getJwtSecret();
  getAccessTokenTtlSeconds();
}
