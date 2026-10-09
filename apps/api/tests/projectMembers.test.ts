import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { cleanupTestUsers, createTestUser } from "./helpers/auth";

const app = createApp();

const createdProjectIds: string[] = [];

afterAll(async () => {
  await prisma.projectMemberHistory.deleteMany({ where: { projectId: { in: createdProjectIds } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: createdProjectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

type Agent = Awaited<ReturnType<typeof createTestUser>>["agent"];

async function createProject(agent: Agent) {
  const res = await agent.post("/projects").send({ name: "Membership Host Project", productName: "Widget" });
  createdProjectIds.push(res.body.id);
  return res.body as { id: string };
}

describe("GET /projects/:id/members", () => {
  it("includes the creator, added automatically", async () => {
    const { agent: pmo, id: pmoId } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);

    const res = await pmo.get(`/projects/${project.id}/members`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ userId: pmoId, addedById: pmoId });
    expect(res.body[0].user.passwordHash).toBeUndefined();
  });

  it("404s for a non-member, non-see-all role", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");

    const res = await designer.get(`/projects/${project.id}/members`);

    expect(res.status).toBe(404);
  });
});

describe("GET /projects/:id/members/candidates", () => {
  it("lists active, non-see-all users not already a member", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { id: alreadyMemberId } = await createTestUser(app, "ENGINEERING");
    await pmo.post(`/projects/${project.id}/members`).send({ userId: alreadyMemberId });
    const { id: inactiveId } = await createTestUser(app, "FINANCE");
    await prisma.user.update({ where: { id: inactiveId }, data: { isActive: false } });
    const { id: managementId } = await createTestUser(app, "MANAGEMENT");

    const res = await pmo.get(`/projects/${project.id}/members/candidates`);

    expect(res.status).toBe(200);
    const ids = res.body.map((u: { id: string }) => u.id);
    expect(ids).toContain(designerId);
    expect(ids).not.toContain(alreadyMemberId);
    expect(ids).not.toContain(inactiveId);
    expect(ids).not.toContain(managementId);
  });

  it.each(["FINANCE", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT", "MERCHANDISER"] as UserRole[])(
    "forbids %s",
    async (role) => {
      const { agent: pmo } = await createTestUser(app, "PMO");
      const project = await createProject(pmo);
      const { agent } = await createTestUser(app, role);

      const res = await agent.get(`/projects/${project.id}/members/candidates`);

      expect(res.status).toBe(403);
    },
  );
});

describe("POST /projects/:id/members", () => {
  it("adds an active, non-see-all user and records an ADDED history entry", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");

    const res = await pmo.post(`/projects/${project.id}/members`).send({ userId: designerId });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(designerId);

    const history = await prisma.projectMemberHistory.findMany({
      where: { projectId: project.id, userId: designerId },
    });
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe("ADDED");
  });

  it("allows ADMIN too", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { agent: admin } = await createTestUser(app, "ADMIN");
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");

    const res = await admin.post(`/projects/${project.id}/members`).send({ userId: designerId });

    expect(res.status).toBe(201);
  });

  it.each(["FINANCE", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT", "MERCHANDISER"] as UserRole[])(
    "forbids %s from adding a member",
    async (role) => {
      const { agent: pmo } = await createTestUser(app, "PMO");
      const project = await createProject(pmo);
      const { agent } = await createTestUser(app, role);
      const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");

      const res = await agent.post(`/projects/${project.id}/members`).send({ userId: designerId });

      expect(res.status).toBe(403);
    },
  );

  it("rejects an inactive user", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    await prisma.user.update({ where: { id: designerId }, data: { isActive: false } });

    const res = await pmo.post(`/projects/${project.id}/members`).send({ userId: designerId });

    expect(res.status).toBe(400);
  });

  it.each(["ADMIN", "PMO", "MANAGEMENT"] as UserRole[])(
    "rejects %s - already sees every Project",
    async (role) => {
      const { agent: pmo } = await createTestUser(app, "PMO");
      const project = await createProject(pmo);
      const { id: seeAllUserId } = await createTestUser(app, role);

      const res = await pmo.post(`/projects/${project.id}/members`).send({ userId: seeAllUserId });

      expect(res.status).toBe(400);
    },
  );

  it("rejects adding the same user twice", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    await pmo.post(`/projects/${project.id}/members`).send({ userId: designerId });

    const res = await pmo.post(`/projects/${project.id}/members`).send({ userId: designerId });

    expect(res.status).toBe(409);
  });

  it("404s a nonexistent Project even for a see-all actor (PMO)", async () => {
    // A see-all role's visibility check returns before any membership
    // lookup, so it never gets the "no rows means no such project either"
    // existence check a non-see-all role's does for free - this is
    // `assertProjectVisible`'s own explicit existence check instead.
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");

    const res = await pmo
      .post("/projects/00000000-0000-0000-0000-000000000000/members")
      .send({ userId: designerId });

    expect(res.status).toBe(404);
  });
});

describe("POST /projects/:id/members/:userId/remove", () => {
  it("removes a member and records a REMOVED history entry", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    await pmo.post(`/projects/${project.id}/members`).send({ userId: designerId });

    const res = await pmo.post(`/projects/${project.id}/members/${designerId}/remove`);

    expect(res.status).toBe(204);
    const row = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: designerId } },
    });
    expect(row).toBeNull();
    const history = await prisma.projectMemberHistory.findMany({
      where: { projectId: project.id, userId: designerId },
      orderBy: { at: "asc" },
    });
    expect(history.map((h) => h.action)).toEqual(["ADDED", "REMOVED"]);
  });

  it("404s removing someone who isn't a member", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");

    const res = await pmo.post(`/projects/${project.id}/members/${designerId}/remove`);

    expect(res.status).toBe(404);
  });

  it.each(["FINANCE", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT", "MERCHANDISER"] as UserRole[])(
    "forbids %s from removing a member",
    async (role) => {
      const { agent: pmo } = await createTestUser(app, "PMO");
      const project = await createProject(pmo);
      const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
      await pmo.post(`/projects/${project.id}/members`).send({ userId: designerId });
      const { agent } = await createTestUser(app, role);

      const res = await agent.post(`/projects/${project.id}/members/${designerId}/remove`);

      expect(res.status).toBe(403);
    },
  );

  it("losing membership 404s the Project for that user immediately", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    await pmo.post(`/projects/${project.id}/members`).send({ userId: designerId });
    expect((await designer.get(`/projects/${project.id}`)).status).toBe(200);

    await pmo.post(`/projects/${project.id}/members/${designerId}/remove`);

    expect((await designer.get(`/projects/${project.id}`)).status).toBe(404);
  });
});

describe("GET /users/:id/projects", () => {
  it("lists the Projects a user is a member of (the other direction)", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: admin } = await createTestUser(app, "ADMIN");
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const projectA = await createProject(pmo);
    const projectB = await createProject(pmo);
    await pmo.post(`/projects/${projectA.id}/members`).send({ userId: designerId });

    const res = await admin.get(`/users/${designerId}/projects`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].project.id).toBe(projectA.id);
    expect(res.body.some((m: { project: { id: string } }) => m.project.id === projectB.id)).toBe(false);
  });

  it("is ADMIN-only, like the rest of /users", async () => {
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: pmo } = await createTestUser(app, "PMO");

    const res = await pmo.get(`/users/${designerId}/projects`);

    expect(res.status).toBe(403);
  });
});
