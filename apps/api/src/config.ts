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

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"]; // the Vite dev server

/**
 * The browser origins allowed to call this API (CORS). An explicit list, never a
 * wildcard: requests carry a bearer token, and "any site may read the responses"
 * is not something to opt into by accident. Comma-separated in
 * `CORS_ALLOWED_ORIGINS`; defaults to the Vite dev origin.
 */
export function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_ALLOWED_ORIGINS;

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      if (entry === "*") {
        throw new Error("CORS_ALLOWED_ORIGINS must list explicit origins, not a wildcard");
      }
      // An origin is scheme + host (+ port): no path, no trailing slash. Browsers
      // send it in exactly that form, so anything else could never match.
      let origin: string;
      try {
        origin = new URL(entry).origin;
      } catch {
        throw new Error(`CORS_ALLOWED_ORIGINS has an invalid origin: ${entry}`);
      }
      if (origin !== entry) {
        throw new Error(
          `CORS_ALLOWED_ORIGINS entries must be bare origins like ${origin}, got: ${entry}`,
        );
      }
      return origin;
    });
}

export function assertAuthConfig(): void {
  getJwtSecret();
  getAccessTokenTtlSeconds();
  getAllowedOrigins();
}
