import { afterEach, describe, expect, it } from "vitest";
import {
  assertAuthConfig,
  getAbsoluteSessionTtlSeconds,
  getAccessTokenTtlSeconds,
  getAllowedOrigins,
  getIdleTimeoutSeconds,
  getJwtSecret,
} from "../src/config";

const original = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN_SECONDS: process.env.JWT_EXPIRES_IN_SECONDS,
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
  REFRESH_IDLE_TIMEOUT_SECONDS: process.env.REFRESH_IDLE_TIMEOUT_SECONDS,
  REFRESH_ABSOLUTE_TTL_SECONDS: process.env.REFRESH_ABSOLUTE_TTL_SECONDS,
};

function restore(name: keyof typeof original) {
  if (original[name] === undefined) delete process.env[name];
  else process.env[name] = original[name];
}

afterEach(() => {
  restore("JWT_SECRET");
  restore("JWT_EXPIRES_IN_SECONDS");
  restore("CORS_ALLOWED_ORIGINS");
  restore("REFRESH_IDLE_TIMEOUT_SECONDS");
  restore("REFRESH_ABSOLUTE_TTL_SECONDS");
});

describe("auth config", () => {
  it("fails loudly when JWT_SECRET is missing or empty", () => {
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET is not set/);

    process.env.JWT_SECRET = "";
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET is not set/);
  });

  it("rejects a secret that is too short to be safe", () => {
    process.env.JWT_SECRET = "too-short";
    expect(() => getJwtSecret()).toThrow(/at least 32 characters/);
  });

  it("accepts a long enough secret", () => {
    process.env.JWT_SECRET = "x".repeat(32);
    expect(getJwtSecret()).toBe("x".repeat(32));
  });

  it("defaults the token lifetime to 15 minutes (ADR 0012 - short-lived now that there's a refresh flow)", () => {
    delete process.env.JWT_EXPIRES_IN_SECONDS;
    expect(getAccessTokenTtlSeconds()).toBe(900);
  });

  it("reads a configured lifetime and rejects nonsense", () => {
    process.env.JWT_EXPIRES_IN_SECONDS = "1800";
    expect(getAccessTokenTtlSeconds()).toBe(1800);

    for (const bad of ["0", "-5", "1.5", "soon"]) {
      process.env.JWT_EXPIRES_IN_SECONDS = bad;
      expect(() => getAccessTokenTtlSeconds()).toThrow(/positive integer/);
    }
  });

  it("assertAuthConfig surfaces either problem at startup", () => {
    process.env.JWT_SECRET = "x".repeat(32);
    process.env.JWT_EXPIRES_IN_SECONDS = "nope";
    expect(() => assertAuthConfig()).toThrow(/positive integer/);

    delete process.env.JWT_SECRET;
    delete process.env.JWT_EXPIRES_IN_SECONDS;
    expect(() => assertAuthConfig()).toThrow(/JWT_SECRET/);
  });
});

describe("session config (ADR 0012)", () => {
  it("defaults the idle timeout to 30 minutes", () => {
    delete process.env.REFRESH_IDLE_TIMEOUT_SECONDS;
    expect(getIdleTimeoutSeconds()).toBe(1800);
  });

  it("reads a configured idle timeout and rejects nonsense", () => {
    process.env.REFRESH_IDLE_TIMEOUT_SECONDS = "600";
    expect(getIdleTimeoutSeconds()).toBe(600);

    for (const bad of ["0", "-5", "1.5", "soon"]) {
      process.env.REFRESH_IDLE_TIMEOUT_SECONDS = bad;
      expect(() => getIdleTimeoutSeconds()).toThrow(/positive integer/);
    }
  });

  it("defaults the absolute session lifetime to 12 hours", () => {
    delete process.env.REFRESH_ABSOLUTE_TTL_SECONDS;
    expect(getAbsoluteSessionTtlSeconds()).toBe(43200);
  });

  it("reads a configured absolute lifetime and rejects nonsense", () => {
    process.env.REFRESH_ABSOLUTE_TTL_SECONDS = "3600";
    expect(getAbsoluteSessionTtlSeconds()).toBe(3600);

    for (const bad of ["0", "-5", "1.5", "soon"]) {
      process.env.REFRESH_ABSOLUTE_TTL_SECONDS = bad;
      expect(() => getAbsoluteSessionTtlSeconds()).toThrow(/positive integer/);
    }
  });
});

describe("CORS allowlist config", () => {
  it("defaults to the Vite dev origin", () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    expect(getAllowedOrigins()).toEqual(["http://localhost:5173"]);

    process.env.CORS_ALLOWED_ORIGINS = "   ";
    expect(getAllowedOrigins()).toEqual(["http://localhost:5173"]);
  });

  it("parses a comma-separated list, ignoring whitespace and empty entries", () => {
    process.env.CORS_ALLOWED_ORIGINS = " https://a.test , ,https://b.test:8443 ";
    expect(getAllowedOrigins()).toEqual(["https://a.test", "https://b.test:8443"]);
  });

  it("rejects a wildcard, since requests carry a bearer token", () => {
    process.env.CORS_ALLOWED_ORIGINS = "*";
    expect(() => getAllowedOrigins()).toThrow(/not a wildcard/);
    process.env.CORS_ALLOWED_ORIGINS = "https://a.test,*";
    expect(() => getAllowedOrigins()).toThrow(/not a wildcard/);
  });

  it.each([
    ["a trailing slash", "https://a.test/"],
    ["a path", "https://a.test/app"],
    ["a bare host with no scheme", "a.test"],
    ["not a URL at all", "not a url"],
  ])("rejects %s, which a browser's Origin header could never match", (_label, value) => {
    process.env.CORS_ALLOWED_ORIGINS = value;
    expect(() => getAllowedOrigins()).toThrow(/CORS_ALLOWED_ORIGINS/);
  });

  it("is checked at startup by assertAuthConfig", () => {
    process.env.JWT_SECRET = "x".repeat(32);
    delete process.env.JWT_EXPIRES_IN_SECONDS;
    process.env.CORS_ALLOWED_ORIGINS = "*";
    expect(() => assertAuthConfig()).toThrow(/wildcard/);
  });
});
