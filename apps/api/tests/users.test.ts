import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { cleanupTestUsers, createTestUser, type TestUser } from "./helpers/auth";

const app = createApp();

const NON_ADMIN_ROLES = [
  "FINANCE",
  "PMO",
  "PRODUCT_DESIGNER",
  "ENGINEERING",
  "MANAGEMENT",
  "MERCHANDISER",
] as UserRole[];

const createdEmails: string[] = [];

function uniqueEmail(prefix = "user-mgmt") {
  const email = `${prefix}-${randomUUID()}@kyvera.test`;
  createdEmails.push(email);
  return email;
}

const INITIAL_PASSWORD = "initial-password";

/**
 * Creates a target user through the real endpoint and immediately completes
 * its forced first password change (ADR 0011 - creation now generates a
 * temporary password and sets mustChangePassword, same as a reset), so
 * every other test gets a normal, usable account with a password it knows -
 * `INITIAL_PASSWORD` - instead of having to deal with the forced-change step
 * itself. Mirrors the real flow: an admin-created account starts in exactly
 * this state.
 */
async function createUserViaApi(admin: TestUser) {
  const email = uniqueEmail();
  const created = await admin.agent.post("/users").send({ name: "Target User", email, role: "FINANCE" });
  const id = created.body.user.id as string;
  const temporaryPassword = created.body.temporaryPassword as string;

  const login = await request(app).post("/auth/login").send({ email, password: temporaryPassword });
  await request(app)
    .post("/auth/change-password")
    .set("Authorization", `Bearer ${login.body.token}`)
    .send({ currentPassword: temporaryPassword, newPassword: INITIAL_PASSWORD });

  return { email, id };
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: createdEmails.map((e) => e.toLowerCase()) } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

describe("GET /users", () => {
  it("lists users with their active status, never the password hash", async () => {
    const { agent } = await createTestUser(app, "ADMIN");

    const res = await agent.get("/users");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const admin = res.body.find((u: { role: string }) => u.role === "ADMIN");
    expect(admin).toMatchObject({ isActive: true });
    expect(admin.passwordHash).toBeUndefined();
  });

  it.each(NON_ADMIN_ROLES)("forbids %s", async (role) => {
    const { agent } = await createTestUser(app, role);

    const res = await agent.get("/users");

    expect(res.status).toBe(403);
  });

  it("requires a token", async () => {
    const res = await request(app).get("/users");
    expect(res.status).toBe(401);
  });
});

describe("POST /users", () => {
  it("generates a temporary password, sets mustChangePassword, and never takes one from the admin", async () => {
    const { agent } = await createTestUser(app, "ADMIN");
    const email = uniqueEmail();

    const res = await agent.post("/users").send({ name: "Fresh User", email, role: "MERCHANDISER" });

    expect(res.status).toBe(201);
    expect(typeof res.body.temporaryPassword).toBe("string");
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(res.body.user).toMatchObject({
      name: "Fresh User",
      email,
      role: "MERCHANDISER",
      isActive: true,
      mustChangePassword: true,
    });
    expect(res.body.user.passwordHash).toBeUndefined();

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordChangedAt).not.toBeNull();

    // The generated password actually works.
    const login = await request(app)
      .post("/auth/login")
      .send({ email, password: res.body.temporaryPassword as string });
    expect(login.status).toBe(200);
  });

  it("rejects a duplicate email with 409", async () => {
    const { agent } = await createTestUser(app, "ADMIN");
    const email = uniqueEmail();
    const first = await agent.post("/users").send({ name: "First", email, role: "FINANCE" });
    expect(first.status).toBe(201);

    const second = await agent.post("/users").send({ name: "Second", email, role: "FINANCE" });

    expect(second.status).toBe(409);
  });

  it.each([
    ["an invalid email", { email: "not-an-email" }],
    ["a missing name", { name: "" }],
    ["an unknown role", { role: "SUPERUSER" }],
  ])("rejects %s with 400", async (_label, overrides) => {
    const { agent } = await createTestUser(app, "ADMIN");
    const res = await agent.post("/users").send({
      name: "Test",
      email: uniqueEmail(),
      role: "FINANCE",
      ...overrides,
    });
    expect(res.status).toBe(400);
  });

  it.each(NON_ADMIN_ROLES)("forbids %s", async (role) => {
    const { agent } = await createTestUser(app, role);

    const res = await agent.post("/users").send({ name: "X", email: uniqueEmail(), role: "FINANCE" });

    expect(res.status).toBe(403);
  });
});

describe("PATCH /users/:id/role", () => {
  it("changes the role", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);

    const res = await admin.agent.patch(`/users/${target.id}/role`).send({ role: "MANAGEMENT" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("MANAGEMENT");
  });

  it("404s an unknown user", async () => {
    const { agent } = await createTestUser(app, "ADMIN");

    const res = await agent.patch(`/users/${randomUUID()}/role`).send({ role: "FINANCE" });

    expect(res.status).toBe(404);
  });

  // The only way to actually reach "this change would leave zero active
  // admins" is an admin demoting *themselves* while no one else is active:
  // if anyone else were active, that other admin remains after the change
  // (not zero), and if they aren't, only the sole active admin could even
  // authenticate to make this request in the first place.
  it("refuses to let the sole active admin demote themselves", async () => {
    const { agent, id } = await createTestUser(app, "ADMIN");
    const others = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true, id: { not: id } } });
    const otherIds = others.map((u) => u.id);

    try {
      await prisma.user.updateMany({ where: { id: { in: otherIds } }, data: { isActive: false } });

      const res = await agent.patch(`/users/${id}/role`).send({ role: "FINANCE" });

      expect(res.status).toBe(409);
    } finally {
      await prisma.user.updateMany({ where: { id: { in: otherIds } }, data: { isActive: true } });
    }
  });

  it.each(NON_ADMIN_ROLES)("forbids %s", async (role) => {
    const { agent } = await createTestUser(app, role);

    const res = await agent.patch(`/users/${randomUUID()}/role`).send({ role: "FINANCE" });

    expect(res.status).toBe(403);
  });
});

describe("POST /users/:id/deactivate", () => {
  it("deactivates the user", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);

    const res = await admin.agent.post(`/users/${target.id}/deactivate`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it("refuses to let an admin deactivate themselves", async () => {
    const { agent, id } = await createTestUser(app, "ADMIN");

    const res = await agent.post(`/users/${id}/deactivate`);

    expect(res.status).toBe(403);
  });

  it("404s an unknown user", async () => {
    const { agent } = await createTestUser(app, "ADMIN");

    const res = await agent.post(`/users/${randomUUID()}/deactivate`);

    expect(res.status).toBe(404);
  });

  it.each(NON_ADMIN_ROLES)("forbids %s", async (role) => {
    const { agent } = await createTestUser(app, role);

    const res = await agent.post(`/users/${randomUUID()}/deactivate`);

    expect(res.status).toBe(403);
  });
});

describe("POST /users/:id/reactivate", () => {
  it("reactivates the user", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);
    await admin.agent.post(`/users/${target.id}/deactivate`);

    const res = await admin.agent.post(`/users/${target.id}/reactivate`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
  });

  it.each(NON_ADMIN_ROLES)("forbids %s", async (role) => {
    const { agent } = await createTestUser(app, role);

    const res = await agent.post(`/users/${randomUUID()}/reactivate`);

    expect(res.status).toBe(403);
  });
});

describe("POST /users/:id/reset-password", () => {
  it("generates a one-time temporary password and sets mustChangePassword", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);

    const res = await admin.agent.post(`/users/${target.id}/reset-password`);

    expect(res.status).toBe(200);
    expect(typeof res.body.temporaryPassword).toBe("string");
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(res.body.user).toMatchObject({ id: target.id, mustChangePassword: true });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("404s an unknown user", async () => {
    const { agent } = await createTestUser(app, "ADMIN");

    const res = await agent.post(`/users/${randomUUID()}/reset-password`);

    expect(res.status).toBe(404);
  });

  it.each(NON_ADMIN_ROLES)("forbids %s", async (role) => {
    const { agent } = await createTestUser(app, role);

    const res = await agent.post(`/users/${randomUUID()}/reset-password`);

    expect(res.status).toBe(403);
  });

  it("invalidates the user's existing token, and the temporary password logs in", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);

    const loggedIn = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: "initial-password" });
    expect(loggedIn.status).toBe(200);
    const oldToken = loggedIn.body.token as string;

    const stillWorks = await request(app).get("/auth/me").set("Authorization", `Bearer ${oldToken}`);
    expect(stillWorks.status).toBe(200);

    const reset = await admin.agent.post(`/users/${target.id}/reset-password`);
    expect(reset.status).toBe(200);
    const temporaryPassword = reset.body.temporaryPassword as string;

    const rejected = await request(app).get("/auth/me").set("Authorization", `Bearer ${oldToken}`);
    expect(rejected.status).toBe(401);

    const oldPasswordFails = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: "initial-password" });
    expect(oldPasswordFails.status).toBe(401);

    const newLogin = await request(app).post("/auth/login").send({ email: target.email, password: temporaryPassword });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.mustChangePassword).toBe(true);
  });
});

describe("a user with mustChangePassword set", () => {
  async function resetAndLogIn(admin: TestUser, target: { email: string; id: string }) {
    const reset = await admin.agent.post(`/users/${target.id}/reset-password`);
    const temporaryPassword = reset.body.temporaryPassword as string;
    const login = await request(app).post("/auth/login").send({ email: target.email, password: temporaryPassword });
    return { token: login.body.token as string, temporaryPassword };
  }

  it("is blocked from an ordinary endpoint, but not from /auth/me or change-password", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);
    const { token, temporaryPassword } = await resetAndLogIn(admin, target);

    const projects = await request(app).get("/projects").set("Authorization", `Bearer ${token}`);
    expect(projects.status).toBe(403);
    expect(projects.body.error).toMatch(/change your password/i);

    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);

    // The real temporary password (not a placeholder) proves this request
    // reached the handler at all - if it were blocked by the same gate as
    // /projects above, it would 403 regardless of the body.
    const changed = await request(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: temporaryPassword, newPassword: "a-new-real-password" });
    expect(changed.status).toBe(200);
  });

  it("can change their own password, which clears mustChangePassword and unblocks everything else", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);
    const reset = await admin.agent.post(`/users/${target.id}/reset-password`);
    const temporaryPassword = reset.body.temporaryPassword as string;
    const login = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: temporaryPassword });
    const token = login.body.token as string;

    const changed = await request(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: temporaryPassword, newPassword: "a-new-real-password" });

    expect(changed.status).toBe(200);
    expect(changed.body.mustChangePassword).toBe(false);

    // The change-password call itself issued no new token - the old one (now
    // past its own passwordChangedAt stamp) must be rejected like any other
    // post-reset token, and a fresh login is required.
    const staleToken = await request(app).get("/projects").set("Authorization", `Bearer ${token}`);
    expect(staleToken.status).toBe(401);

    const freshLogin = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: "a-new-real-password" });
    expect(freshLogin.status).toBe(200);
    expect(freshLogin.body.user.mustChangePassword).toBe(false);

    const projects = await request(app)
      .get("/projects")
      .set("Authorization", `Bearer ${freshLogin.body.token}`);
    expect(projects.status).toBe(200);
  });
});

describe("POST /auth/change-password", () => {
  it("rejects the wrong current password with 403", async () => {
    const { agent } = await createTestUser(app, "FINANCE");

    const res = await agent.post("/auth/change-password").send({
      currentPassword: "definitely-not-it",
      newPassword: "a-new-real-password",
    });

    expect(res.status).toBe(403);
  });

  it("rejects a weak new password with 400", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);
    const login = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: "initial-password" });

    const res = await request(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${login.body.token}`)
      .send({ currentPassword: "initial-password", newPassword: "short" });

    expect(res.status).toBe(400);
  });
});

describe("an inactive user", () => {
  it("cannot log in, and gets the same error as a wrong password", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);
    await admin.agent.post(`/users/${target.id}/deactivate`);

    const res = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: "initial-password" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  it("has their existing token rejected on the very next request", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);

    const loggedIn = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: "initial-password" });
    const token = loggedIn.body.token as string;

    await admin.agent.post(`/users/${target.id}/deactivate`);

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
