import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { attachmentStorage } from "../src/services/storage";
import { cleanupTestUsers, createTestUser } from "./helpers/auth";

const app = createApp();

// Deletion order matters, same reasoning as techPacks.test.ts: Attachment ->
// TechPackRemark/TechPackConfirmation/TechPackApproval -> TechPackVersion ->
// TechPack -> Project -> users, since every FK this domain adds is
// `onDelete: Restrict` (ADR 0006, point 9) rather than Cascade.
const createdProjectIds: string[] = [];
const createdTechPackIds: string[] = [];

afterAll(async () => {
  const attachments = await prisma.attachment.findMany({
    where: { techPackVersion: { techPackId: { in: createdTechPackIds } } },
    select: { id: true, storageKey: true },
  });
  await prisma.attachment.deleteMany({ where: { id: { in: attachments.map((a) => a.id) } } });
  await Promise.all(attachments.map((a) => attachmentStorage.delete(a.storageKey)));

  await prisma.techPackRemark.deleteMany({
    where: { techPackVersion: { techPackId: { in: createdTechPackIds } } },
  });
  await prisma.techPackConfirmation.deleteMany({
    where: { techPackVersion: { techPackId: { in: createdTechPackIds } } },
  });
  await prisma.techPackApproval.deleteMany({
    where: { techPackVersion: { techPackId: { in: createdTechPackIds } } },
  });
  await prisma.techPackVersion.deleteMany({ where: { techPackId: { in: createdTechPackIds } } });
  await prisma.techPack.deleteMany({ where: { id: { in: createdTechPackIds } } });
  await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

type Agent = Awaited<ReturnType<typeof createTestUser>>["agent"];

async function createProject(agent: Agent, body: Record<string, unknown> = {}) {
  const res = await agent
    .post("/projects")
    .send({ name: "Review Host Project", productName: "Widget", ...body });
  createdProjectIds.push(res.body.id);
  return res.body as { id: string; phase: string };
}

async function createTechPack(agent: Agent, projectId: string) {
  const res = await agent
    .post("/tech-packs")
    .field("projectId", projectId)
    .attach("files", Buffer.from("tech pack bytes"), "spec.pdf");
  if (res.status === 201) createdTechPackIds.push(res.body.id);
  return res;
}

async function uploadVersion(agent: Agent, techPackId: string) {
  return agent
    .post(`/tech-packs/${techPackId}/versions`)
    .attach("files", Buffer.from("revision bytes"), "revision.pdf");
}

function remarksPath(techPackId: string, versionNumber: number | string) {
  return `/tech-packs/${techPackId}/versions/${versionNumber}/remarks`;
}

function confirmPath(techPackId: string, versionNumber: number | string) {
  return `/tech-packs/${techPackId}/versions/${versionNumber}/confirm`;
}

async function setUpVersion1(designerRole: UserRole = "PRODUCT_DESIGNER") {
  const { agent: pmo } = await createTestUser(app, "PMO");
  const { agent: designer } = await createTestUser(app, designerRole);
  const project = await createProject(pmo);
  const created = await createTechPack(designer, project.id);
  return { designer, techPackId: created.body.id as string, techPackCode: created.body.code as string };
}

describe("POST /tech-packs/:id/versions/:versionNumber/remarks", () => {
  it("adds a remark, trimmed, with the author's safe shape", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering.post(remarksPath(techPackId, 1)).send({ body: "  please revise the BOM  " });

    expect(res.status).toBe(201);
    expect(res.body.body).toBe("please revise the BOM");
    expect(res.body.author.passwordHash).toBeUndefined();
    expect(res.body.author.role).toBe("ENGINEERING");
  });

  it("allows PRODUCT_DESIGNER and ADMIN too", async () => {
    const { techPackId, designer } = await setUpVersion1();
    const { agent: admin } = await createTestUser(app, "ADMIN");

    const fromDesigner = await designer.post(remarksPath(techPackId, 1)).send({ body: "acknowledged" });
    const fromAdmin = await admin.post(remarksPath(techPackId, 1)).send({ body: "noted" });

    expect(fromDesigner.status).toBe(201);
    expect(fromAdmin.status).toBe(201);
  });

  it.each(["MANAGER", "ENGINEER", "FINANCE", "PMO", "MANAGEMENT", "MERCHANDISER"] as UserRole[])(
    "forbids %s",
    async (role) => {
      const { techPackId } = await setUpVersion1();
      const { agent } = await createTestUser(app, role);

      const res = await agent.post(remarksPath(techPackId, 1)).send({ body: "hello" });

      expect(res.status).toBe(403);
    },
  );

  it("rejects a blank body", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering.post(remarksPath(techPackId, 1)).send({ body: "   " });

    expect(res.status).toBe(400);
  });

  it("rejects a body over the max length", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering.post(remarksPath(techPackId, 1)).send({ body: "x".repeat(5001) });

    expect(res.status).toBe(400);
  });

  it("refuses a new remark on a voided TechPack", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");
    await prisma.techPack.update({
      where: { id: techPackId },
      data: { voidedAt: new Date(), voidReason: "test setup" },
    });

    const res = await engineering.post(remarksPath(techPackId, 1)).send({ body: "too late" });

    expect(res.status).toBe(409);
  });

  it("is allowed on a non-latest version - review history stays discussable", async () => {
    const { techPackId, designer } = await setUpVersion1();
    await uploadVersion(designer, techPackId);
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering.post(remarksPath(techPackId, 1)).send({ body: "about v1 specifically" });

    expect(res.status).toBe(201);
  });

  it("404s an unknown TechPack id", async () => {
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering
      .post(remarksPath("00000000-0000-0000-0000-000000000000", 1))
      .send({ body: "hello" });

    expect(res.status).toBe(404);
  });

  it("404s an unknown version number", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering.post(remarksPath(techPackId, 99)).send({ body: "hello" });

    expect(res.status).toBe(404);
  });

  it("404s a malformed version number rather than erroring", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering.post(remarksPath(techPackId, "not-a-number")).send({ body: "hello" });

    expect(res.status).toBe(404);
  });
});

describe("GET /tech-packs/:id/versions/:versionNumber/remarks", () => {
  it("lists remarks oldest first, for any authenticated role", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");
    const { agent: finance } = await createTestUser(app, "FINANCE");
    await engineering.post(remarksPath(techPackId, 1)).send({ body: "first" });
    await engineering.post(remarksPath(techPackId, 1)).send({ body: "second" });

    const res = await finance.get(remarksPath(techPackId, 1));

    expect(res.status).toBe(200);
    expect(res.body.map((r: { body: string }) => r.body)).toEqual(["first", "second"]);
  });

  it("404s an unknown version number", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: finance } = await createTestUser(app, "FINANCE");

    const res = await finance.get(remarksPath(techPackId, 99));

    expect(res.status).toBe(404);
  });
});

describe("POST /tech-packs/:id/versions/:versionNumber/confirm", () => {
  it("confirms the latest version, with the confirmer's safe shape", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering.post(confirmPath(techPackId, 1)).send({});

    expect(res.status).toBe(201);
    expect(res.body.confirmedBy.passwordHash).toBeUndefined();
    expect(res.body.confirmedBy.role).toBe("ENGINEERING");
    expect(res.body.confirmedAt).toEqual(expect.any(String));
  });

  it.each([
    "MANAGER",
    "ENGINEER",
    "FINANCE",
    "PMO",
    "PRODUCT_DESIGNER",
    "MANAGEMENT",
    "MERCHANDISER",
    "ADMIN",
  ] as UserRole[])("forbids %s, including ADMIN (ADR 0009)", async (role) => {
    const { techPackId } = await setUpVersion1();
    const { agent } = await createTestUser(app, role);

    const res = await agent.post(confirmPath(techPackId, 1)).send({});

    expect(res.status).toBe(403);
  });

  it("404s an unknown TechPack id", async () => {
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering
      .post(confirmPath("00000000-0000-0000-0000-000000000000", 1))
      .send({});

    expect(res.status).toBe(404);
  });

  it("404s an unknown version number", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering.post(confirmPath(techPackId, 99)).send({});

    expect(res.status).toBe(404);
  });

  it("refuses to confirm a voided TechPack", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");
    await prisma.techPack.update({
      where: { id: techPackId },
      data: { voidedAt: new Date(), voidReason: "test setup" },
    });

    const res = await engineering.post(confirmPath(techPackId, 1)).send({});

    expect(res.status).toBe(409);
  });

  it("refuses to confirm once the TechPack already has an approved version", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");
    const { id: managementUserId } = await createTestUser(app, "MANAGEMENT");
    const techPack = await prisma.techPack.findUniqueOrThrow({
      where: { id: techPackId },
      include: { versions: true },
    });
    await prisma.techPackApproval.create({
      data: {
        techPackVersion: { connect: { id: techPack.versions[0].id } },
        decision: "APPROVED",
        decidedBy: { connect: { id: managementUserId } },
      },
    });

    const res = await engineering.post(confirmPath(techPackId, 1)).send({});

    expect(res.status).toBe(409);
  });

  it("refuses to confirm a version that is no longer the latest", async () => {
    const { techPackId, designer } = await setUpVersion1();
    await uploadVersion(designer, techPackId);
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const res = await engineering.post(confirmPath(techPackId, 1)).send({});

    expect(res.status).toBe(409);
  });

  it("refuses to confirm the same version twice", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const first = await engineering.post(confirmPath(techPackId, 1)).send({});
    expect(first.status).toBe(201);

    const second = await engineering.post(confirmPath(techPackId, 1)).send({});

    expect(second.status).toBe(409);
  });

  it("lets exactly one of two concurrent confirms win for the same version", async () => {
    const { techPackId } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const [a, b] = await Promise.allSettled([
      engineering.post(confirmPath(techPackId, 1)).send({}),
      engineering.post(confirmPath(techPackId, 1)).send({}),
    ]);

    const statuses = [a, b]
      .map((result) => (result.status === "fulfilled" ? result.value.status : result.reason))
      .sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("leaves a later version unconfirmed after confirming an earlier one", async () => {
    const { techPackId, designer } = await setUpVersion1();
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");

    const confirmed = await engineering.post(confirmPath(techPackId, 1)).send({});
    expect(confirmed.status).toBe(201);

    await uploadVersion(designer, techPackId);

    const detail = await engineering.get(`/tech-packs/${techPackId}`);
    const [v2, v1] = detail.body.versions;
    expect(v1.versionNumber).toBe(1);
    expect(v1.confirmation).not.toBeNull();
    expect(v2.versionNumber).toBe(2);
    expect(v2.confirmation).toBeNull();
  });
});
