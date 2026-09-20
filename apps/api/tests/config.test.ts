import { afterEach, describe, expect, it } from "vitest";
import {
  assertAuthConfig,
  getAccessTokenTtlSeconds,
  getAllowedOrigins,
  getJwtSecret,
} from "../src/config";

const original = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN_SECONDS: process.env.JWT_EXPIRES_IN_SECONDS,
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
};

function restore(name: keyof typeof original) {
  if (original[name] === undefined) delete process.env[name];
  else process.env[name] = original[name];
}

afterEach(() => {
  restore("JWT_SECRET");
  restore("JWT_EXPIRES_IN_SECONDS");
  restore("CORS_ALLOWED_ORIGINS");
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

  it("defaults the token lifetime to one hour", () => {
    delete process.env.JWT_EXPIRES_IN_SECONDS;
    expect(getAccessTokenTtlSeconds()).toBe(3600);
  });

  it("reads a configured lifetime and rejects nonsense", () => {
    process.env.JWT_EXPIRES_IN_SECONDS = "900";
    expect(getAccessTokenTtlSeconds()).toBe(900);

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
