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

/** Creates a target user through the real endpoint, so it has a real,
 * known temporary password - the fixture tests actually log in with. */
async function createUserViaApi(admin: TestUser) {
  const email = uniqueEmail();
  const res = await admin.agent.post("/users").send({
    name: "Target User",
    email,
    role: "FINANCE",
    temporaryPassword: "initial-password",
  });
  return { email, id: res.body.id as string };
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
  it("creates a user with a hashed temporary password and isActive true", async () => {
    const { agent } = await createTestUser(app, "ADMIN");
    const email = uniqueEmail();

    const res = await agent.post("/users").send({
      name: "Fresh User",
      email,
      role: "MERCHANDISER",
      temporaryPassword: "a-temporary-password",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Fresh User", email, role: "MERCHANDISER", isActive: true });
    expect(res.body.passwordHash).toBeUndefined();

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordChangedAt).not.toBeNull();
  });

  it("rejects a duplicate email with 409", async () => {
    const { agent } = await createTestUser(app, "ADMIN");
    const email = uniqueEmail();
    const first = await agent
      .post("/users")
      .send({ name: "First", email, role: "FINANCE", temporaryPassword: "a-temporary-password" });
    expect(first.status).toBe(201);

    const second = await agent
      .post("/users")
      .send({ name: "Second", email, role: "FINANCE", temporaryPassword: "another-password" });

    expect(second.status).toBe(409);
  });

  it.each([
    ["an invalid email", { email: "not-an-email" }],
    ["a too-short password", { temporaryPassword: "short" }],
    ["a too-long password", { temporaryPassword: "x".repeat(129) }],
    ["a missing name", { name: "" }],
    ["an unknown role", { role: "SUPERUSER" }],
  ])("rejects %s with 400", async (_label, overrides) => {
    const { agent } = await createTestUser(app, "ADMIN");
    const res = await agent.post("/users").send({
      name: "Test",
      email: uniqueEmail(),
      role: "FINANCE",
      temporaryPassword: "a-temporary-password",
      ...overrides,
    });
    expect(res.status).toBe(400);
  });

  it.each(NON_ADMIN_ROLES)("forbids %s", async (role) => {
    const { agent } = await createTestUser(app, role);

    const res = await agent
      .post("/users")
      .send({ name: "X", email: uniqueEmail(), role: "FINANCE", temporaryPassword: "a-temporary-password" });

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
  it("rejects a weak new password with 400", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);

    const res = await admin.agent.post(`/users/${target.id}/reset-password`).send({ password: "short" });

    expect(res.status).toBe(400);
  });

  it.each(NON_ADMIN_ROLES)("forbids %s", async (role) => {
    const { agent } = await createTestUser(app, role);

    const res = await agent.post(`/users/${randomUUID()}/reset-password`).send({ password: "a-new-password" });

    expect(res.status).toBe(403);
  });

  it("invalidates the user's existing token, and the new password works for a fresh login", async () => {
    const admin = await createTestUser(app, "ADMIN");
    const target = await createUserViaApi(admin);

    const loggedIn = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: "initial-password" });
    expect(loggedIn.status).toBe(200);
    const oldToken = loggedIn.body.token as string;

    const stillWorks = await request(app).get("/auth/me").set("Authorization", `Bearer ${oldToken}`);
    expect(stillWorks.status).toBe(200);

    const reset = await admin.agent
      .post(`/users/${target.id}/reset-password`)
      .send({ password: "a-brand-new-password" });
    expect(reset.status).toBe(200);

    const rejected = await request(app).get("/auth/me").set("Authorization", `Bearer ${oldToken}`);
    expect(rejected.status).toBe(401);

    const oldPasswordFails = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: "initial-password" });
    expect(oldPasswordFails.status).toBe(401);

    const newLogin = await request(app)
      .post("/auth/login")
      .send({ email: target.email, password: "a-brand-new-password" });
    expect(newLogin.status).toBe(200);

    const worksNow = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${newLogin.body.token}`);
    expect(worksNow.status).toBe(200);
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
