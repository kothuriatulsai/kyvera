import { readdir } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createApp } from "../src/app";
import { getUploadsDir } from "../src/config";
import { prisma } from "../src/repositories/prismaClient";
import { attachmentStorage } from "../src/services/storage";
import { cleanupTestUsers, createTestUser } from "./helpers/auth";

const app = createApp();

// Deletion order matters: Attachment -> TechPackVersion -> TechPack -> Project
// -> users, since every FK this domain adds is `onDelete: Restrict` (ADR 0006,
// point 9) rather than Cascade.
const createdProjectIds: string[] = [];
const createdTechPackIds: string[] = [];
const createdStorageKeys: string[] = [];

afterAll(async () => {
  const attachments = await prisma.attachment.findMany({
    where: { techPackVersion: { techPackId: { in: createdTechPackIds } } },
    select: { id: true, storageKey: true },
  });
  await prisma.attachment.deleteMany({ where: { id: { in: attachments.map((a) => a.id) } } });
  await Promise.all(attachments.map((a) => attachmentStorage.delete(a.storageKey)));
  await Promise.all(createdStorageKeys.map((key) => attachmentStorage.delete(key)));

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
    .send({ name: "Tech Pack Host Project", productName: "Widget", ...body });
  createdProjectIds.push(res.body.id);
  return res.body as { id: string; phase: string };
}

interface UploadFile {
  name: string;
  content?: string;
}

async function createTechPack(
  agent: Agent,
  projectId: string,
  opts: { notes?: string; files?: UploadFile[] } = {},
) {
  const files = opts.files ?? [{ name: "spec.pdf" }];
  let req = agent.post("/tech-packs").field("projectId", projectId);
  if (opts.notes !== undefined) req = req.field("notes", opts.notes);
  for (const file of files) {
    req = req.attach("files", Buffer.from(file.content ?? "tech pack bytes"), file.name);
  }
  const res = await req;
  if (res.status === 201) createdTechPackIds.push(res.body.id);
  return res;
}

async function uploadVersion(
  agent: Agent,
  techPackId: string,
  opts: { notes?: string; files?: UploadFile[] } = {},
) {
  const files = opts.files ?? [{ name: "revision.pdf" }];
  let req = agent.post(`/tech-packs/${techPackId}/versions`);
  if (opts.notes !== undefined) req = req.field("notes", opts.notes);
  for (const file of files) {
    req = req.attach("files", Buffer.from(file.content ?? "revision bytes"), file.name);
  }
  return req;
}

describe("POST /tech-packs", () => {
  it("creates a TechPack with version 1 and its attachment, owned by the authenticated actor", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);

    const res = await createTechPack(designer, project.id, {
      notes: "first cut",
      files: [{ name: "spec.pdf", content: "the actual spec" }],
    });

    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^TP-\d{6,}$/);
    expect(res.body.phase).toBe("PROTO");
    expect(res.body.voidedAt).toBeNull();
    expect(res.body.versions).toHaveLength(1);

    const [version] = res.body.versions;
    expect(version).toMatchObject({ versionNumber: 1, notes: "first cut" });
    expect(version.uploadedBy.passwordHash).toBeUndefined();
    expect(version.attachments).toHaveLength(1);
    expect(version.attachments[0]).toMatchObject({
      originalName: "spec.pdf",
      mimeType: "application/pdf",
      sizeBytes: Buffer.from("the actual spec").length,
    });
  });

  it("accepts more than one file on a single version", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);

    const res = await createTechPack(designer, project.id, {
      files: [{ name: "spec.pdf" }, { name: "reference.png" }],
    });

    expect(res.status).toBe(201);
    expect(res.body.versions[0].attachments).toHaveLength(2);
  });

  it("allows ADMIN too", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: admin } = await createTestUser(app, "ADMIN");
    const project = await createProject(pmo);

    const res = await createTechPack(admin, project.id);

    expect(res.status).toBe(201);
  });

  it.each([
    "FINANCE",
    "PMO",
    "ENGINEERING",
    "MANAGEMENT",
    "MERCHANDISER",
  ] as UserRole[])("forbids %s", async (role) => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent } = await createTestUser(app, role);
    const project = await createProject(pmo);

    const res = await createTechPack(agent, project.id);

    expect(res.status).toBe(403);
  });

  it("requires at least one file", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);

    const res = await createTechPack(designer, project.id, { files: [] });

    expect(res.status).toBe(400);
  });

  it("rejects a disallowed file extension", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);

    const res = await createTechPack(designer, project.id, { files: [{ name: "payload.exe" }] });

    expect(res.status).toBe(400);
  });

  it("404s a projectId that doesn't reference an existing Project", async () => {
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");

    const res = await createTechPack(designer, "00000000-0000-0000-0000-000000000000");

    expect(res.status).toBe(404);
  });

  it("refuses a second active TechPack for the same Project and phase", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);

    const first = await createTechPack(designer, project.id);
    expect(first.status).toBe(201);

    const second = await createTechPack(designer, project.id);
    expect(second.status).toBe(409);
  });

  it("lets exactly one of two concurrent creates win for the same Project and phase", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);

    const [a, b] = await Promise.allSettled([
      createTechPack(designer, project.id),
      createTechPack(designer, project.id),
    ]);

    const statuses = [a, b]
      .map((result) => (result.status === "fulfilled" ? result.value.status : result.reason))
      .sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("allows a new active TechPack once the first was voided", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);

    const first = await createTechPack(designer, project.id);
    await prisma.techPack.update({
      where: { id: first.body.id },
      data: { voidedAt: new Date(), voidReason: "test setup" },
    });

    const second = await createTechPack(designer, project.id);

    expect(second.status).toBe(201);
  });
});

describe("POST /tech-packs/:id/versions", () => {
  it("adds version 2 to an existing TechPack", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);
    const created = await createTechPack(designer, project.id);

    const res = await uploadVersion(designer, created.body.id, { notes: "addressed remarks" });

    expect(res.status).toBe(201);
    expect(res.body.versions).toHaveLength(2);
    expect(res.body.versions[0]).toMatchObject({ versionNumber: 2, notes: "addressed remarks" });
    expect(res.body.versions[1]).toMatchObject({ versionNumber: 1 });
  });

  it("404s an unknown TechPack id", async () => {
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");

    const res = await uploadVersion(designer, "00000000-0000-0000-0000-000000000000");

    expect(res.status).toBe(404);
  });

  it("refuses a new version on a voided TechPack", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);
    const created = await createTechPack(designer, project.id);
    await prisma.techPack.update({
      where: { id: created.body.id },
      data: { voidedAt: new Date(), voidReason: "test setup" },
    });

    const res = await uploadVersion(designer, created.body.id);

    expect(res.status).toBe(409);
  });

  it("leaves no orphan files on disk when the transaction fails", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);
    const created = await createTechPack(designer, project.id);
    await prisma.techPack.update({
      where: { id: created.body.id },
      data: { voidedAt: new Date(), voidReason: "test setup" },
    });

    const before = (await readdir(getUploadsDir())).sort();

    const res = await uploadVersion(designer, created.body.id, {
      files: [{ name: "a.pdf" }, { name: "b.png" }],
    });

    expect(res.status).toBe(409);
    const after = (await readdir(getUploadsDir())).sort();
    expect(after).toEqual(before);
  });

  it("refuses a new version once a version has been approved", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { id: managementUserId } = await createTestUser(app, "MANAGEMENT");
    const project = await createProject(pmo);
    const created = await createTechPack(designer, project.id);
    await prisma.techPackApproval.create({
      data: {
        techPackVersion: { connect: { id: created.body.versions[0].id } },
        decision: "APPROVED",
        decidedBy: { connect: { id: managementUserId } },
      },
    });

    const res = await uploadVersion(designer, created.body.id);

    expect(res.status).toBe(409);
  });

  it.each(["FINANCE", "PMO", "ENGINEERING", "MANAGEMENT"] as UserRole[])(
    "forbids %s",
    async (role) => {
      const { agent: pmo } = await createTestUser(app, "PMO");
      const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
      const { agent } = await createTestUser(app, role);
      const project = await createProject(pmo);
      const created = await createTechPack(designer, project.id);

      const res = await uploadVersion(agent, created.body.id);

      expect(res.status).toBe(403);
    },
  );
});

describe("GET /tech-packs and /tech-packs/:id", () => {
  it("lists tech packs, optionally filtered by projectId, for any authenticated role", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: finance } = await createTestUser(app, "FINANCE");
    const projectA = await createProject(pmo);
    const projectB = await createProject(pmo);
    const inA = await createTechPack(designer, projectA.id);
    await createTechPack(designer, projectB.id);

    const filtered = await finance.get(`/tech-packs?projectId=${projectA.id}`);

    expect(filtered.status).toBe(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].id).toBe(inA.body.id);
  });

  it("reads one back with its versions and attachments nested", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);
    const created = await createTechPack(designer, project.id);

    const res = await designer.get(`/tech-packs/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.versions[0].attachments).toHaveLength(1);
  });

  it("404s an unknown (but well-formed) id", async () => {
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");

    const res = await designer.get("/tech-packs/00000000-0000-0000-0000-000000000000");

    expect(res.status).toBe(404);
  });
});

describe("GET /attachments/:id/download", () => {
  it("streams the file back with the original name and MIME type", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);
    const created = await createTechPack(designer, project.id, {
      files: [{ name: "spec.pdf", content: "exact bytes to round-trip" }],
    });
    const attachmentId = created.body.versions[0].attachments[0].id;

    const res = await designer.get(`/attachments/${attachmentId}/download`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toContain('filename="spec.pdf"');
    expect(res.headers["content-length"]).toBe(String(Buffer.from("exact bytes to round-trip").length));
  });

  it("404s an unknown attachment id", async () => {
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");

    const res = await designer.get("/attachments/00000000-0000-0000-0000-000000000000/download");

    expect(res.status).toBe(404);
  });
});
