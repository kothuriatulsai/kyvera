import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { getJwtSecret } from "../src/config";
import { prisma } from "../src/repositories/prismaClient";
import { signAccessToken } from "../src/services/tokenService";

const app = createApp();

const PASSWORD = "correct-horse-battery";
const createdEmails: string[] = [];

function uniqueEmail(prefix = "auth-test") {
  const email = `${prefix}-${randomUUID()}@kyvera.test`;
  createdEmails.push(email);
  return email;
}

async function registerUser(overrides: Record<string, unknown> = {}) {
  const email = uniqueEmail();
  const res = await request(app)
    .post("/auth/register")
    .send({ name: "Auth Test User", email, password: PASSWORD, ...overrides });
  return { email, res };
}

async function loginAs(email: string, password = PASSWORD) {
  return request(app).post("/auth/login").send({ email, password });
}

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: createdEmails.map((e) => e.toLowerCase()) } } });
  await prisma.$disconnect();
});

describe("POST /auth/register", () => {
  it("creates a user without exposing the password hash", async () => {
    const { email, res } = await registerUser();

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Auth Test User", email, role: "ENGINEER" });
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.passwordHash).toBeUndefined();
  });

  it("stores an argon2id hash, never the password", async () => {
    const { email } = await registerUser();

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(PASSWORD);
  });

  it("always creates the least-privileged role and rejects an attempt to choose one", async () => {
    const { email, res } = await registerUser({ role: "ADMIN" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role cannot be set/i);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("normalises email case and rejects a duplicate regardless of case", async () => {
    const email = uniqueEmail("Mixed.Case");
    const first = await request(app)
      .post("/auth/register")
      .send({ name: "First", email, password: PASSWORD });
    expect(first.status).toBe(201);
    expect(first.body.email).toBe(email.toLowerCase());

    const duplicate = await request(app)
      .post("/auth/register")
      .send({ name: "Second", email: email.toUpperCase(), password: PASSWORD });
    expect(duplicate.status).toBe(409);
  });

  it.each([
    ["an invalid email", { email: "not-an-email" }],
    ["a too-short password", { password: "short" }],
    ["a too-long password", { password: "x".repeat(129) }],
    ["a missing name", { name: "" }],
    ["a missing password", { password: undefined }],
  ])("rejects %s with 400", async (_label, overrides) => {
    const { res } = await registerUser(overrides);
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  it("issues a token with only id and role claims", async () => {
    const { email, res: registered } = await registerUser();

    const res = await loginAs(email);

    expect(res.status).toBe(200);
    expect(res.body.tokenType).toBe("Bearer");
    expect(res.body.user).toMatchObject({ id: registered.body.id, email, role: "ENGINEER" });
    expect(res.body.user.passwordHash).toBeUndefined();

    // Nothing that can go stale (assignments, ownership) is baked into the token.
    const payload = decodePayload(res.body.token);
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "role", "sub"]);
    expect(payload.sub).toBe(registered.body.id);
    expect(payload.role).toBe("ENGINEER");
    expect((payload.exp as number) - (payload.iat as number)).toBe(res.body.expiresIn);
  });

  it("matches the email case-insensitively", async () => {
    const { email } = await registerUser();

    const res = await loginAs(email.toUpperCase());

    expect(res.status).toBe(200);
  });

  it("rejects a wrong password and an unknown email identically", async () => {
    const { email } = await registerUser();

    const wrongPassword = await loginAs(email, "definitely-not-it");
    const unknownEmail = await loginAs(`nobody-${randomUUID()}@kyvera.test`);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Same body, so the endpoint can't be used to find out which emails exist.
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.headers["www-authenticate"]).toBe("Bearer");
  });

  it("treats a user whose stored password isn't a real hash as a failed login, not a 500", async () => {
    // The seed used to write a plain-text placeholder here before auth existed.
    const email = uniqueEmail("legacy");
    await prisma.user.create({
      data: { name: "Legacy", email, role: "ENGINEER", passwordHash: "unset-no-auth-module-yet" },
    });

    const res = await loginAs(email, "unset-no-auth-module-yet");

    expect(res.status).toBe(401);
  });

  it("rejects a missing password with 400", async () => {
    const res = await request(app).post("/auth/login").send({ email: "someone@kyvera.test" });
    expect(res.status).toBe(400);
  });
});

describe("authentication on protected routes", () => {
  it("returns 401 with no token", async () => {
    const res = await request(app).get("/products");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
  });

  it("returns 200 with a token issued by /auth/login", async () => {
    const { email } = await registerUser();
    const { body } = await loginAs(email);

    const products = await request(app).get("/products").set("Authorization", `Bearer ${body.token}`);
    const stages = await request(app).get("/stages").set("Authorization", `Bearer ${body.token}`);

    expect(products.status).toBe(200);
    expect(stages.status).toBe(200);
  });

  // Table-driven so a route added later can't quietly be left open.
  it.each([
    ["GET", "/products"],
    ["POST", "/products"],
    ["GET", "/products/abc"],
    ["GET", "/products/abc/delay"],
    ["PATCH", "/products/abc"],
    ["DELETE", "/products/abc"],
    ["POST", "/products/abc/versions"],
    ["POST", "/products/abc/transition"],
    ["GET", "/stages"],
    ["GET", "/auth/me"],
  ] as const)("requires a token for %s %s", async (method, path) => {
    const res = await request(app)[method.toLowerCase() as "get"](path);
    expect(res.status).toBe(401);
  });

  it("does not require a token for /health, /auth/register or /auth/login", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
    // 400 (bad body), not 401: these routes are reachable without a token.
    expect((await request(app).post("/auth/register").send({})).status).toBe(400);
    expect((await request(app).post("/auth/login").send({})).status).toBe(400);
  });

  it("does not reveal which paths exist to an unauthenticated caller", async () => {
    const res = await request(app).get("/definitely/not/a/route");
    expect(res.status).toBe(401);
  });

  it("still 404s an unknown path for an authenticated caller", async () => {
    const { email } = await registerUser();
    const { body } = await loginAs(email);

    const res = await request(app)
      .get("/definitely/not/a/route")
      .set("Authorization", `Bearer ${body.token}`);

    expect(res.status).toBe(404);
  });

  describe("rejects a bad token", () => {
    const secret = () => getJwtSecret();
    const validClaims = { role: "ADMIN" };

    async function getWith(authorization: string) {
      return request(app).get("/products").set("Authorization", authorization);
    }

    it("that isn't a bearer credential", async () => {
      expect((await getWith("Basic dXNlcjpwYXNz")).status).toBe(401);
      expect((await getWith("Bearer")).status).toBe(401);
      expect((await getWith("Bearer a b")).status).toBe(401);
    });

    it("that is garbage", async () => {
      expect((await getWith("Bearer not.a.jwt")).status).toBe(401);
    });

    it("signed with a different secret", async () => {
      const forged = jwt.sign(validClaims, "a-completely-different-secret-value-1234", {
        subject: randomUUID(),
      });
      expect((await getWith(`Bearer ${forged}`)).status).toBe(401);
    });

    it("that has expired", async () => {
      const expired = jwt.sign(
        { ...validClaims, exp: Math.floor(Date.now() / 1000) - 60 },
        secret(),
        { subject: randomUUID() },
      );

      const res = await getWith(`Bearer ${expired}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/expired/i);
    });

    it("that uses alg none", async () => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({ ...validClaims, sub: randomUUID() })}.`;

      expect((await getWith(`Bearer ${unsigned}`)).status).toBe(401);
    });

    it("signed correctly but with an unknown role or no subject", async () => {
      const badRole = jwt.sign({ role: "SUPERUSER" }, secret(), { subject: randomUUID() });
      const noSubject = jwt.sign(validClaims, secret());

      expect((await getWith(`Bearer ${badRole}`)).status).toBe(401);
      expect((await getWith(`Bearer ${noSubject}`)).status).toBe(401);
    });
  });
});

describe("GET /auth/me", () => {
  it("returns the caller, proving the verified actor reaches the handler", async () => {
    const { email, res: registered } = await registerUser();
    const { body } = await loginAs(email);

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${body.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: registered.body.id, email, role: "ENGINEER" });
    expect(res.body.passwordHash).toBeUndefined();
  });

  it("returns 401 for a valid token whose user no longer exists", async () => {
    const { token } = signAccessToken({ id: randomUUID(), role: "ENGINEER" });

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
