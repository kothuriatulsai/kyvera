import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const DEV_ORIGIN = "http://localhost:5173";
const original = process.env.CORS_ALLOWED_ORIGINS;

afterEach(() => {
  if (original === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
  else process.env.CORS_ALLOWED_ORIGINS = original;
});

function preflight(app: ReturnType<typeof createApp>, path: string, origin: string) {
  return request(app)
    .options(path)
    .set("Origin", origin)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "authorization,content-type");
}

describe("CORS", () => {
  it("allows the Vite dev origin by default, echoing it back rather than using a wildcard", async () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    const app = createApp();

    const res = await request(app).get("/health").set("Origin", DEV_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(DEV_ORIGIN);
    expect(res.headers.vary).toMatch(/Origin/i);
  });

  it("answers an allowed origin's preflight, including the Authorization header", async () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    const app = createApp();

    const res = await preflight(app, "/auth/login", DEV_ORIGIN);

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(DEV_ORIGIN);
    expect(res.headers["access-control-allow-methods"]).toMatch(/POST/);
    expect(res.headers["access-control-allow-headers"]).toMatch(/Authorization/i);
  });

  it("does not ask for a token on a preflight, even for a protected route", async () => {
    // A browser sends the preflight *without* credentials. If it needed a token
    // every call to a protected route would fail with a 401 that looks like a
    // login bug.
    delete process.env.CORS_ALLOWED_ORIGINS;
    const app = createApp();

    const res = await preflight(app, "/products", DEV_ORIGIN);

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(DEV_ORIGIN);
  });

  it("gives a disallowed origin no CORS grant at all, so a browser refuses the response", async () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    const app = createApp();

    const simple = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(simple.headers["access-control-allow-origin"]).toBeUndefined();
    expect(simple.headers["access-control-allow-credentials"]).toBeUndefined();

    const pre = await preflight(app, "/auth/login", "https://evil.example");
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
    expect(pre.headers["access-control-allow-methods"]).toBeUndefined();
    expect(pre.headers["access-control-allow-headers"]).toBeUndefined();
  });

  it("is not fooled by an origin that merely looks like an allowed one", async () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    const app = createApp();

    for (const lookalike of [
      "http://localhost:5174", // wrong port
      "https://localhost:5173", // wrong scheme
      "http://localhost:5173.evil.example", // suffix
      "http://evil.example/http://localhost:5173",
    ]) {
      const res = await request(app).get("/health").set("Origin", lookalike);
      expect(res.headers["access-control-allow-origin"], lookalike).toBeUndefined();
    }
  });

  it("leaves a request with no Origin header (curl, server to server) alone", async () => {
    const app = createApp();

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reads the allowlist from CORS_ALLOWED_ORIGINS, replacing the default", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.kyvera.test, https://staging.kyvera.test:8443";
    const app = createApp();

    for (const allowed of ["https://app.kyvera.test", "https://staging.kyvera.test:8443"]) {
      const res = await request(app).get("/health").set("Origin", allowed);
      expect(res.headers["access-control-allow-origin"]).toBe(allowed);
    }
    // The default is no longer allowed once an explicit list is configured.
    const dev = await request(app).get("/health").set("Origin", DEV_ORIGIN);
    expect(dev.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("refuses to start with a wildcard in the allowlist", () => {
    process.env.CORS_ALLOWED_ORIGINS = "*";
    expect(() => createApp()).toThrow(/explicit origins, not a wildcard/);
  });
});
