import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { hashPassword } from "../src/services/passwordService";
import { cleanupTestUsers, createTestUser } from "./helpers/auth";

const app = createApp();

const PASSWORD = "correct-horse-battery";
const DEV_ORIGIN = "http://localhost:5173"; // the default CORS_ALLOWED_ORIGINS entry
const REFRESH_COOKIE_NAME = "kyvera_refresh";

const createdEmails: string[] = [];

function uniqueEmail(prefix = "session-test") {
  const email = `${prefix}-${randomUUID()}@kyvera.test`;
  createdEmails.push(email);
  return email;
}

/** A real user with a real, known password - logs in for real, unlike
 * helpers/auth.ts's synthetic-token `createTestUser`, so these tests can
 * exercise the actual login -> refresh -> rotate flow end to end. */
async function createRealUser(role: "FINANCE" | "ADMIN" = "FINANCE") {
  const email = uniqueEmail();
  const user = await prisma.user.create({
    data: { name: "Session Test User", email, role, passwordHash: await hashPassword(PASSWORD) },
  });
  return { email, id: user.id };
}

function loginAs(email: string, password = PASSWORD) {
  return request(app).post("/auth/login").send({ email, password });
}

/** Pulls just the `name=value` pair for the refresh cookie out of a
 * response's Set-Cookie header, discarding attributes - what a subsequent
 * request's own `Cookie` header needs. */
function extractRefreshCookie(res: request.Response): string {
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!raw) throw new Error("Response carried no refresh cookie");
  return raw.split(";")[0];
}

// `origin: null` means "send no Origin header at all" - distinct from the
// default, since a default parameter value doesn't kick in for an
// explicitly-passed `undefined` the way it would for an omitted argument.
function refresh(cookie?: string, origin: string | null = DEV_ORIGIN) {
  let req = request(app).post("/auth/refresh");
  if (cookie) req = req.set("Cookie", cookie);
  if (origin) req = req.set("Origin", origin);
  return req;
}

function logout(cookie?: string, origin: string | null = DEV_ORIGIN) {
  let req = request(app).post("/auth/logout");
  if (cookie) req = req.set("Cookie", cookie);
  if (origin) req = req.set("Origin", origin);
  return req;
}

async function sessionRowFromCookie(cookie: string) {
  const value = cookie.slice(`${REFRESH_COOKIE_NAME}=`.length);
  const sessionId = value.slice(0, value.indexOf("."));
  return prisma.userSession.findUniqueOrThrow({ where: { id: sessionId } });
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: createdEmails.map((e) => e.toLowerCase()) } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

describe("POST /auth/login", () => {
  it("creates a session and sets an httpOnly refresh cookie", async () => {
    const { email } = await createRealUser();

    const res = await loginAs(email);

    expect(res.status).toBe(200);
    expect(typeof res.body.idleTimeoutSeconds).toBe("number");
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    const raw = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(raw).toBeTruthy();
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\/auth/i);
    // Not Secure in this (non-production) test run - see refreshCookieOptions.
    expect(raw).not.toMatch(/Secure/i);

    const row = await sessionRowFromCookie(extractRefreshCookie(res));
    expect(row.revokedAt).toBeNull();
  });
});

describe("POST /auth/refresh", () => {
  it("rotates the refresh token and issues a new access token", async () => {
    const { email } = await createRealUser();
    const loggedIn = await loginAs(email);
    const cookie1 = extractRefreshCookie(loggedIn);
    const token1 = loggedIn.body.token as string;

    const res = await refresh(cookie1);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.token).not.toBe(token1);
    const cookie2 = extractRefreshCookie(res);
    expect(cookie2).not.toBe(cookie1);
  });

  it("requires a refresh cookie", async () => {
    const res = await refresh(undefined);
    expect(res.status).toBe(401);
  });

  it("rejects a garbage cookie value", async () => {
    const res = await refresh(`${REFRESH_COOKIE_NAME}=not-a-real-token`);
    expect(res.status).toBe(401);
  });

  it("requires an allowed Origin", async () => {
    const { email } = await createRealUser();
    const cookie = extractRefreshCookie(await loginAs(email));

    expect((await refresh(cookie, null)).status).toBe(403);
    expect((await refresh(cookie, "https://evil.example")).status).toBe(403);
  });

  describe("rotation races and reuse", () => {
    it("a stale cookie presented within the grace window succeeds, without revoking (two-tab race)", async () => {
      const { email } = await createRealUser();
      const cookie1 = extractRefreshCookie(await loginAs(email));

      const firstRefresh = await refresh(cookie1);
      expect(firstRefresh.status).toBe(200);

      // A second tab, racing the first, still holds cookie1 - already
      // rotated away, but only a moment ago.
      const secondTab = await refresh(cookie1);
      expect(secondTab.status).toBe(200);
      const cookie3 = extractRefreshCookie(secondTab);

      // Not revoked: the newest cookie from the race still works.
      expect((await refresh(cookie3)).status).toBe(200);
    });

    it("two refreshes fired concurrently with the same cookie both succeed, without revoking", async () => {
      const { email } = await createRealUser();
      const cookie1 = extractRefreshCookie(await loginAs(email));

      // Genuinely concurrent, not sequential: both requests are in flight
      // before either resolves, so whichever the database serializes second
      // sees the first's write already landed - this is what a compare-
      // and-swap rotation (rather than a blind read-then-update) has to
      // survive without treating the loser as token reuse.
      const [first, second] = await Promise.all([refresh(cookie1), refresh(cookie1)]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const cookieA = extractRefreshCookie(first);
      const cookieB = extractRefreshCookie(second);
      expect(cookieA).not.toBe(cookieB);

      const row = await sessionRowFromCookie(cookie1);
      expect(row.revokedAt).toBeNull();

      // Whichever of the two lost the database race re-rotated from the
      // winner's new hash instead of being treated as reuse - the loser's
      // own cookie is still good, within the grace window.
      expect((await refresh(cookieA)).status).toBe(200);
    });

    it("a stale cookie presented outside the grace window is reuse - revokes the whole session", async () => {
      const { email } = await createRealUser();
      const cookie1 = extractRefreshCookie(await loginAs(email));

      const firstRefresh = await refresh(cookie1);
      const cookie2 = extractRefreshCookie(firstRefresh);
      const row = await sessionRowFromCookie(cookie1);
      await prisma.userSession.update({
        where: { id: row.id },
        data: { rotatedAt: new Date(Date.now() - 61_000) },
      });

      const reused = await refresh(cookie1);
      expect(reused.status).toBe(401);

      // The whole session is gone now, not just the stale cookie.
      const afterRevoke = await refresh(cookie2);
      expect(afterRevoke.status).toBe(401);
    });
  });

  describe("timeouts", () => {
    it("rejects a refresh once the idle timeout has passed, without revoking", async () => {
      const { email } = await createRealUser();
      const cookie = extractRefreshCookie(await loginAs(email));
      const row = await sessionRowFromCookie(cookie);
      await prisma.userSession.update({
        where: { id: row.id },
        data: { lastUsedAt: new Date(Date.now() - 31 * 60 * 1000) }, // > the 30-minute default
      });

      const res = await refresh(cookie);

      expect(res.status).toBe(401);
      const stillThere = await prisma.userSession.findUniqueOrThrow({ where: { id: row.id } });
      expect(stillThere.revokedAt).toBeNull();
    });

    it("rejects a refresh past the absolute session limit, even if recently used", async () => {
      const { email } = await createRealUser();
      const cookie = extractRefreshCookie(await loginAs(email));
      const row = await sessionRowFromCookie(cookie);
      await prisma.userSession.update({
        where: { id: row.id },
        data: { expiresAt: new Date(Date.now() - 1000), lastUsedAt: new Date() },
      });

      const res = await refresh(cookie);

      expect(res.status).toBe(401);
    });
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session: the refresh cookie and the access token it issued both stop working", async () => {
    const { email } = await createRealUser();
    const loggedIn = await loginAs(email);
    const cookie = extractRefreshCookie(loggedIn);
    const accessToken = loggedIn.body.token as string;

    // Proves the access token worked before logout, so the next assertion
    // means something.
    const before = await request(app).get("/projects").set("Authorization", `Bearer ${accessToken}`);
    expect(before.status).toBe(200);

    const loggedOut = await logout(cookie);
    expect(loggedOut.status).toBe(204);

    // Immediate revocation (ADR 0012's sid claim) - no need to wait out the
    // access token's own expiry.
    const after = await request(app).get("/projects").set("Authorization", `Bearer ${accessToken}`);
    expect(after.status).toBe(401);

    expect((await refresh(cookie)).status).toBe(401);
  });

  it("requires an allowed Origin", async () => {
    const { email } = await createRealUser();
    const cookie = extractRefreshCookie(await loginAs(email));

    expect((await logout(cookie, null)).status).toBe(403);
    expect((await logout(cookie, "https://evil.example")).status).toBe(403);
  });

  it("succeeds even with no cookie to revoke", async () => {
    const res = await logout(undefined);
    expect(res.status).toBe(204);
  });
});

describe("session revocation on other actions (ADR 0012)", () => {
  it("a self-service password change revokes every session", async () => {
    const { email } = await createRealUser();
    const loggedIn = await loginAs(email);
    const cookie = extractRefreshCookie(loggedIn);
    const accessToken = loggedIn.body.token as string;

    const changed = await request(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: "a-brand-new-password" });
    expect(changed.status).toBe(200);

    const afterChange = await request(app).get("/projects").set("Authorization", `Bearer ${accessToken}`);
    expect(afterChange.status).toBe(401);
    expect((await refresh(cookie)).status).toBe(401);
  });

  it("an admin's password reset revokes every one of the target's sessions", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const { email, id: targetId } = await createRealUser();
    const loggedIn = await loginAs(email);
    const cookie = extractRefreshCookie(loggedIn);
    const accessToken = loggedIn.body.token as string;

    const reset = await admin.agent.post(`/users/${targetId}/reset-password`);
    expect(reset.status).toBe(200);

    const afterReset = await request(app).get("/projects").set("Authorization", `Bearer ${accessToken}`);
    expect(afterReset.status).toBe(401);
    expect((await refresh(cookie)).status).toBe(401);
  });

  it("deactivation revokes every one of the target's sessions", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const { email, id: targetId } = await createRealUser();
    const loggedIn = await loginAs(email);
    const cookie = extractRefreshCookie(loggedIn);
    const accessToken = loggedIn.body.token as string;

    const deactivated = await admin.agent.post(`/users/${targetId}/deactivate`);
    expect(deactivated.status).toBe(200);

    const afterDeactivate = await request(app).get("/projects").set("Authorization", `Bearer ${accessToken}`);
    expect(afterDeactivate.status).toBe(401);
    expect((await refresh(cookie)).status).toBe(401);

    // Reactivate so this user doesn't trip up the "last active admin" math
    // for any test that happens to run after this one in the same suite.
    await admin.agent.post(`/users/${targetId}/reactivate`);
  });

  it("a role change does NOT revoke sessions - only password changes, resets and deactivation do", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const { email, id: targetId } = await createRealUser();
    const loggedIn = await loginAs(email);
    const cookie = extractRefreshCookie(loggedIn);
    const accessToken = loggedIn.body.token as string;

    const changedRole = await admin.agent.patch(`/users/${targetId}/role`).send({ role: "PMO" });
    expect(changedRole.status).toBe(200);

    const stillWorks = await request(app).get("/projects").set("Authorization", `Bearer ${accessToken}`);
    expect(stillWorks.status).toBe(200);
    expect((await refresh(cookie)).status).toBe(200);
  });
});
