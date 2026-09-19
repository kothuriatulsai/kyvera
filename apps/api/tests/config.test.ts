import { afterEach, describe, expect, it } from "vitest";
import { assertAuthConfig, getAccessTokenTtlSeconds, getJwtSecret } from "../src/config";

const original = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN_SECONDS: process.env.JWT_EXPIRES_IN_SECONDS,
};

function restore(name: keyof typeof original) {
  if (original[name] === undefined) delete process.env[name];
  else process.env[name] = original[name];
}

afterEach(() => {
  restore("JWT_SECRET");
  restore("JWT_EXPIRES_IN_SECONDS");
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
