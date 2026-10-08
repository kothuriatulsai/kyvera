import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { getJwtSecret } from "../src/config";
import { prisma } from "../src/repositories/prismaClient";
import { hashPassword } from "../src/services/passwordService";
import { signAccessToken } from "../src/services/tokenService";

const app = createApp();

const PASSWORD = "correct-horse-battery";
const createdEmails: string[] = [];

function uniqueEmail(prefix = "auth-test") {
  const email = `${prefix}-${randomUUID()}@kyvera.test`;
  createdEmails.push(email);
  return email;
}

// There is no self-registration endpoint (ADR 0010) - accounts come from the
// seed only, so tests create their own users directly.
async function createTestUser(role: "FINANCE" | "ADMIN" = "FINANCE") {
  const email = uniqueEmail();
  const passwordHash = await hashPassword(PASSWORD);
  const user = await prisma.user.create({
    data: { name: "Auth Test User", email, role, passwordHash },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  return { email, user };
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

describe("POST /auth/login", () => {
  it("issues a token with only id and role claims", async () => {
    const { email, user } = await createTestUser();

    const res = await loginAs(email);

    expect(res.status).toBe(200);
    expect(res.body.tokenType).toBe("Bearer");
    expect(res.body.user).toMatchObject({ id: user.id, email, role: "FINANCE" });
    expect(res.body.user.passwordHash).toBeUndefined();

    // Nothing that can go stale (assignments, ownership) is baked into the token.
    // `iatMs` (ADR 0011) and `sid` (ADR 0012) are the exceptions: millisecond-
    // precision issue time and the backing session id, used only for the
    // password-reset and immediate-revocation checks, not identity/role claims.
    const payload = decodePayload(res.body.token);
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "iatMs", "role", "sid", "sub"]);
    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe("FINANCE");
    expect((payload.exp as number) - (payload.iat as number)).toBe(res.body.expiresIn);
  });

  it("matches the email case-insensitively", async () => {
    const { email } = await createTestUser();

    const res = await loginAs(email.toUpperCase());

    expect(res.status).toBe(200);
  });

  it("rejects a wrong password and an unknown email identically", async () => {
    const { email } = await createTestUser();

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
      data: { name: "Legacy", email, role: "FINANCE", passwordHash: "unset-no-auth-module-yet" },
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
    const res = await request(app).get("/projects");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
  });

  it("returns 200 with a token issued by /auth/login", async () => {
    const { email } = await createTestUser();
    const { body } = await loginAs(email);

    const projects = await request(app).get("/projects").set("Authorization", `Bearer ${body.token}`);

    expect(projects.status).toBe(200);
  });

  // Table-driven so a route added later can't quietly be left open.
  it.each([
    ["GET", "/auth/me"],
    ["POST", "/auth/change-password"],
    ["GET", "/projects"],
    ["POST", "/projects"],
    ["GET", "/projects/abc"],
    ["GET", "/tech-packs"],
    ["POST", "/tech-packs"],
    ["GET", "/tech-packs/abc"],
    ["POST", "/tech-packs/abc/versions"],
    ["GET", "/tech-packs/abc/versions/1/remarks"],
    ["POST", "/tech-packs/abc/versions/1/remarks"],
    ["POST", "/tech-packs/abc/versions/1/confirm"],
    ["POST", "/tech-packs/abc/versions/1/decision"],
    ["GET", "/proto-requests"],
    ["GET", "/proto-requests/abc"],
    ["GET", "/attachments/abc/download"],
    ["GET", "/users"],
    ["POST", "/users"],
    ["PATCH", "/users/abc/role"],
    ["POST", "/users/abc/deactivate"],
    ["POST", "/users/abc/reactivate"],
    ["POST", "/users/abc/reset-password"],
  ] as const)("requires a token for %s %s", async (method, path) => {
    const res = await request(app)[method.toLowerCase() as "get"](path);
    expect(res.status).toBe(401);
  });

  it("does not require a token for /health or /auth/login", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
    // 400 (bad body), not 401: this route is reachable without a token.
    expect((await request(app).post("/auth/login").send({})).status).toBe(400);
  });

  it("does not reveal which paths exist to an unauthenticated caller", async () => {
    const res = await request(app).get("/definitely/not/a/route");
    expect(res.status).toBe(401);
  });

  it("still 404s an unknown path for an authenticated caller", async () => {
    const { email } = await createTestUser();
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
      return request(app).get("/projects").set("Authorization", authorization);
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
    const { email, user } = await createTestUser();
    const { body } = await loginAs(email);

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${body.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: user.id, email, role: "FINANCE" });
    expect(res.body.passwordHash).toBeUndefined();
  });

  it("returns 401 for a valid token whose user no longer exists", async () => {
    const { token } = signAccessToken({ id: randomUUID(), role: "FINANCE" }, randomUUID());

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
