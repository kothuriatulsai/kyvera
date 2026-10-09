import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { attachmentStorage } from "../src/services/storage";
import { cleanupTestUsers, createTestUser } from "./helpers/auth";
import { addMember } from "./helpers/membership";

const app = createApp();

/**
 * ADR 0013's endpoint x role matrix, as tests. Every SOP read endpoint, one
 * `it.each` row per role, covering both halves of the matrix the ADR's
 * table documents: layer A (member vs non-member) and layer B (stage).
 * Write actions (create/upload/remark/confirm/decide, add/remove member)
 * already have their own role x visibility coverage alongside their other
 * tests (techPacks.test.ts, techPackReview.test.ts, techPackDecision.test.ts,
 * projectMembers.test.ts) - this file is the reads, where the interesting
 * per-role *shape* of a response lives, not just a yes/no.
 */

const SEE_ALL: UserRole[] = ["ADMIN", "PMO", "MANAGEMENT"];
const MEMBER_GATED: UserRole[] = ["PRODUCT_DESIGNER", "ENGINEERING", "FINANCE", "MERCHANDISER"];

const createdProjectIds: string[] = [];
const createdTechPackIds: string[] = [];

afterAll(async () => {
  const attachments = await prisma.attachment.findMany({
    where: { techPackVersion: { techPackId: { in: createdTechPackIds } } },
    select: { id: true, storageKey: true },
  });
  await prisma.attachment.deleteMany({ where: { id: { in: attachments.map((a) => a.id) } } });
  await Promise.all(attachments.map((a) => attachmentStorage.delete(a.storageKey)));

  await prisma.protoRequest.deleteMany({ where: { techPackVersion: { techPackId: { in: createdTechPackIds } } } });
  await prisma.techPackRemark.deleteMany({ where: { techPackVersion: { techPackId: { in: createdTechPackIds } } } });
  await prisma.techPackConfirmation.deleteMany({
    where: { techPackVersion: { techPackId: { in: createdTechPackIds } } },
  });
  await prisma.techPackApproval.deleteMany({
    where: { techPackVersion: { techPackId: { in: createdTechPackIds } } },
  });
  await prisma.techPackVersion.deleteMany({ where: { techPackId: { in: createdTechPackIds } } });
  await prisma.techPack.deleteMany({ where: { id: { in: createdTechPackIds } } });
  await prisma.projectMemberHistory.deleteMany({ where: { projectId: { in: createdProjectIds } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: createdProjectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

type Agent = Awaited<ReturnType<typeof createTestUser>>["agent"];

async function createProject(agent: Agent) {
  const res = await agent.post("/projects").send({ name: "Visibility Matrix Project", productName: "Widget" });
  createdProjectIds.push(res.body.id);
  return res.body as { id: string };
}

async function createTechPack(agent: Agent, projectId: string) {
  const res = await agent
    .post("/tech-packs")
    .field("projectId", projectId)
    .attach("files", Buffer.from("tech pack bytes"), "spec.pdf");
  if (res.status === 201) createdTechPackIds.push(res.body.id);
  return res;
}

/** Everyone who can ever act in the SOP domain, as members of one Project -
 * the fixture every role-matrix test below reads from. */
async function setUpProject() {
  const { agent: pmo, id: pmoId } = await createTestUser(app, "PMO");
  const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
  const { agent: engineering, id: engineeringId } = await createTestUser(app, "ENGINEERING");
  const { agent: management } = await createTestUser(app, "MANAGEMENT");
  const { agent: admin } = await createTestUser(app, "ADMIN");
  const { agent: finance, id: financeId } = await createTestUser(app, "FINANCE");
  const { agent: merchandiser, id: merchandiserId } = await createTestUser(app, "MERCHANDISER");

  const project = await createProject(pmo);
  await addMember(project.id, designerId);
  await addMember(project.id, engineeringId);
  await addMember(project.id, financeId);
  await addMember(project.id, merchandiserId);

  const agents: Record<UserRole, Agent> = {
    PMO: pmo,
    PRODUCT_DESIGNER: designer,
    ENGINEERING: engineering,
    MANAGEMENT: management,
    ADMIN: admin,
    FINANCE: finance,
    MERCHANDISER: merchandiser,
  };

  return { project, agents, pmoId };
}

describe("GET /projects/:id - layer A", () => {
  it.each(SEE_ALL)("%s sees the Project without being a member", async (role) => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { agent } = await createTestUser(app, role);

    const res = await agent.get(`/projects/${project.id}`);

    expect(res.status).toBe(200);
  });

  it.each(MEMBER_GATED)("%s 404s a Project they aren't a member of", async (role) => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const project = await createProject(pmo);
    const { agent } = await createTestUser(app, role);

    const res = await agent.get(`/projects/${project.id}`);

    expect(res.status).toBe(404);
  });

  it.each(MEMBER_GATED)("%s sees the Project once added as a member", async (role) => {
    const { project, agents } = await setUpProject();

    const res = await agents[role].get(`/projects/${project.id}`);

    expect(res.status).toBe(200);
  });
});

describe("GET /tech-packs/:id - layer B, before any version is confirmed", () => {
  it.each(["ADMIN", "PMO", "PRODUCT_DESIGNER", "ENGINEERING"] as UserRole[])(
    "%s sees the unconfirmed version",
    async (role) => {
      const { project, agents } = await setUpProject();
      const created = await createTechPack(agents.PRODUCT_DESIGNER, project.id);

      const res = await agents[role].get(`/tech-packs/${created.body.id}`);

      expect(res.status).toBe(200);
      expect(res.body.versions).toHaveLength(1);
    },
  );

  it.each(["MANAGEMENT", "FINANCE", "MERCHANDISER"] as UserRole[])(
    "%s 404s - nothing confirmed yet",
    async (role) => {
      const { project, agents } = await setUpProject();
      const created = await createTechPack(agents.PRODUCT_DESIGNER, project.id);

      const res = await agents[role].get(`/tech-packs/${created.body.id}`);

      expect(res.status).toBe(404);
    },
  );
});

describe("GET /tech-packs/:id - layer B, once v1 is confirmed", () => {
  async function setUpConfirmed() {
    const fixture = await setUpProject();
    const created = await createTechPack(fixture.agents.PRODUCT_DESIGNER, fixture.project.id);
    const techPackId = created.body.id as string;
    const confirmed = await fixture.agents.ENGINEERING.post(`/tech-packs/${techPackId}/versions/1/confirm`).send(
      {},
    );
    expect(confirmed.status).toBe(201);
    return { ...fixture, techPackId };
  }

  it.each(["ADMIN", "PMO", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT"] as UserRole[])(
    "%s sees it",
    async (role) => {
      const { agents, techPackId } = await setUpConfirmed();

      const res = await agents[role].get(`/tech-packs/${techPackId}`);

      expect(res.status).toBe(200);
      expect(res.body.versions).toHaveLength(1);
    },
  );

  it("MANAGEMENT sees the confirmation but no remarks, even though one exists", async () => {
    const { agents, techPackId } = await setUpConfirmed();
    await agents.ENGINEERING.post(`/tech-packs/${techPackId}/versions/1/remarks`).send({ body: "a remark" });

    const res = await agents.MANAGEMENT.get(`/tech-packs/${techPackId}`);

    expect(res.body.versions[0].confirmation).not.toBeNull();
    expect(res.body.versions[0].remarks).toEqual([]);
    expect(res.body.hasPendingNewerVersion).toBeFalsy();
  });

  it("MANAGEMENT sees hasPendingNewerVersion once a newer, unconfirmed version is uploaded", async () => {
    const { agents, techPackId } = await setUpConfirmed();
    await agents.PRODUCT_DESIGNER.post(`/tech-packs/${techPackId}/versions`).attach(
      "files",
      Buffer.from("v2 bytes"),
      "v2.pdf",
    );

    const res = await agents.MANAGEMENT.get(`/tech-packs/${techPackId}`);

    expect(res.status).toBe(200);
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.versions[0].versionNumber).toBe(1);
    expect(res.body.hasPendingNewerVersion).toBe(true);
  });

  it.each(["FINANCE", "MERCHANDISER"] as UserRole[])("%s still 404s - they never browse Tech Packs", async (role) => {
    const { agents, techPackId } = await setUpConfirmed();

    const res = await agents[role].get(`/tech-packs/${techPackId}`);

    expect(res.status).toBe(404);
  });
});

describe("GET /tech-packs/:id/versions/:versionNumber/remarks - layer B", () => {
  it.each(["ADMIN", "PMO", "PRODUCT_DESIGNER", "ENGINEERING"] as UserRole[])(
    "%s sees real remarks",
    async (role) => {
      const { agents, project } = await setUpProject();
      const created = await createTechPack(agents.PRODUCT_DESIGNER, project.id);
      const techPackId = created.body.id as string;
      await agents.ENGINEERING.post(`/tech-packs/${techPackId}/versions/1/remarks`).send({ body: "hello" });

      const res = await agents[role].get(`/tech-packs/${techPackId}/versions/1/remarks`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    },
  );

  it.each(["FINANCE", "MERCHANDISER"] as UserRole[])("%s 404s", async (role) => {
    const { agents, project } = await setUpProject();
    const created = await createTechPack(agents.PRODUCT_DESIGNER, project.id);

    const res = await agents[role].get(`/tech-packs/${created.body.id}/versions/1/remarks`);

    expect(res.status).toBe(404);
  });
});

describe("GET /attachments/:id/download - layer B", () => {
  async function setUpApproved() {
    const fixture = await setUpProject();
    const created = await createTechPack(fixture.agents.PRODUCT_DESIGNER, fixture.project.id);
    const techPackId = created.body.id as string;
    const attachmentId = created.body.versions[0].attachments[0].id as string;
    await fixture.agents.ENGINEERING.post(`/tech-packs/${techPackId}/versions/1/confirm`).send({});
    const decided = await fixture.agents.MANAGEMENT.post(`/tech-packs/${techPackId}/versions/1/decision`).send({
      decision: "APPROVED",
    });
    expect(decided.status).toBe(201);
    return { ...fixture, techPackId, attachmentId };
  }

  it.each(["ADMIN", "PMO", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT"] as UserRole[])(
    "%s downloads it once approved",
    async (role) => {
      const { agents, attachmentId } = await setUpApproved();

      const res = await agents[role].get(`/attachments/${attachmentId}/download`);

      expect(res.status).toBe(200);
    },
  );

  it.each(["FINANCE", "MERCHANDISER"] as UserRole[])(
    "%s downloads it once it's pinned by a Proto Request",
    async (role) => {
      const { agents, attachmentId } = await setUpApproved();

      const res = await agents[role].get(`/attachments/${attachmentId}/download`);

      expect(res.status).toBe(200);
    },
  );

  it.each(["FINANCE", "MERCHANDISER"] as UserRole[])(
    "%s 404s before anything is approved - nothing pins the version yet",
    async (role) => {
      const { agents, project } = await setUpProject();
      const created = await createTechPack(agents.PRODUCT_DESIGNER, project.id);
      const attachmentId = created.body.versions[0].attachments[0].id as string;

      const res = await agents[role].get(`/attachments/${attachmentId}/download`);

      expect(res.status).toBe(404);
    },
  );

  it.each(MEMBER_GATED)("%s 404s as a non-member regardless of Tech Pack state", async (role) => {
    const { agent } = await createTestUser(app, role);
    const { agents, project } = await setUpProject();
    const created = await createTechPack(agents.PRODUCT_DESIGNER, project.id);
    const attachmentId = created.body.versions[0].attachments[0].id as string;

    const res = await agent.get(`/attachments/${attachmentId}/download`);

    expect(res.status).toBe(404);
  });
});

describe("GET /tech-packs and /proto-requests (lists) - layer A/B combined", () => {
  it.each(MEMBER_GATED)("%s gets an empty list for a Project they aren't a member of", async (role) => {
    const { agent } = await createTestUser(app, role);
    const { agents, project } = await setUpProject();
    await createTechPack(agents.PRODUCT_DESIGNER, project.id);

    const res = await agent.get(`/tech-packs?projectId=${project.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each(["FINANCE", "MERCHANDISER"] as UserRole[])(
    "%s gets an empty Tech Pack list even as a member",
    async (role) => {
      const { agents, project } = await setUpProject();
      await createTechPack(agents.PRODUCT_DESIGNER, project.id);

      const res = await agents[role].get(`/tech-packs?projectId=${project.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    },
  );

  it("ENGINEERING's Tech Pack list excludes a TechPack with zero versions", async () => {
    // The only way to a zero-version TechPack is a rejection's successor -
    // built directly here rather than through the full reject flow, since
    // that's already covered in techPackDecision.test.ts.
    const { agents, project, pmoId } = await setUpProject();
    const successor = await prisma.techPack.create({
      data: { project: { connect: { id: project.id } }, createdBy: { connect: { id: pmoId } } },
    });
    createdTechPackIds.push(successor.id);

    const res = await agents.ENGINEERING.get(`/tech-packs?projectId=${project.id}`);

    expect(res.status).toBe(200);
    expect(res.body.some((tp: { id: string }) => tp.id === successor.id)).toBe(false);
  });
});

