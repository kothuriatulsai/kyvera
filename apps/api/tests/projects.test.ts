import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { cleanupTestUsers, createTestUser } from "./helpers/auth";

const app = createApp();

// Project.createdBy is onDelete: Restrict (ADR 0006, point 9 - deliberately
// stricter than the old module), so created Projects must be deleted before
// their creator users, or cleanupTestUsers() fails with a FK violation.
const createdProjectIds: string[] = [];

async function createProject(
  agent: Awaited<ReturnType<typeof createTestUser>>["agent"],
  body: Record<string, unknown>,
) {
  const res = await agent.post("/projects").send(body);
  if (res.status === 201) createdProjectIds.push(res.body.id);
  return res;
}

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

describe("POST /projects", () => {
  it("creates a Project with a generated code, owned by the authenticated actor", async () => {
    const { agent } = await createTestUser(app, "PMO");

    const res = await createProject(agent, {
      name: "Solar Lantern Proto",
      productName: "Solar Lantern",
      productCategory: "Lighting",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Solar Lantern Proto",
      productName: "Solar Lantern",
      productCategory: "Lighting",
      phase: "PROTO",
      status: "ACTIVE",
    });
    expect(res.body.code).toMatch(/^PRJ-\d{6,}$/);
    expect(res.body.createdBy.passwordHash).toBeUndefined();
  });

  it("does not require productCategory", async () => {
    const { agent } = await createTestUser(app, "PMO");

    const res = await createProject(agent, { name: "No Category", productName: "Widget" });

    expect(res.status).toBe(201);
    expect(res.body.productCategory).toBeNull();
  });

  it.each(["name", "productName"] as const)("requires %s", async (field) => {
    const { agent } = await createTestUser(app, "PMO");
    const body: Record<string, string> = { name: "A", productName: "B" };
    delete body[field];

    const res = await createProject(agent, body);

    expect(res.status).toBe(400);
  });

  it("allows ADMIN too", async () => {
    const { agent } = await createTestUser(app, "ADMIN");

    const res = await createProject(agent, { name: "Admin Project", productName: "Widget" });

    expect(res.status).toBe(201);
  });

  // Table-driven so a role added later can't accidentally gain (or a typo
  // can't accidentally lose) access to creating a Project.
  it.each([
    "MANAGER",
    "ENGINEER",
    "FINANCE",
    "PRODUCT_DESIGNER",
    "ENGINEERING",
    "MANAGEMENT",
    "MERCHANDISER",
  ] as UserRole[])("forbids %s", async (role) => {
    const { agent } = await createTestUser(app, role);

    const res = await createProject(agent, { name: "Nope", productName: "Widget" });

    expect(res.status).toBe(403);
  });
});

describe("GET /projects and /projects/:id", () => {
  it("lists projects and reads one back, for any authenticated role", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const created = await createProject(pmo, { name: "Readable Project", productName: "Widget" });

    const { agent: finance } = await createTestUser(app, "FINANCE");

    const list = await finance.get("/projects");
    expect(list.status).toBe(200);
    expect(list.body.some((p: { id: string }) => p.id === created.body.id)).toBe(true);

    const detail = await finance.get(`/projects/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(created.body.id);
  });

  it("404s an unknown (but well-formed) id", async () => {
    const { agent } = await createTestUser(app, "PMO");

    const res = await agent.get("/projects/00000000-0000-0000-0000-000000000000");

    expect(res.status).toBe(404);
  });

  it("404s a malformed id rather than erroring", async () => {
    const { agent } = await createTestUser(app, "PMO");

    const res = await agent.get("/projects/not-a-uuid");

    expect(res.status).toBe(404);
  });
});
