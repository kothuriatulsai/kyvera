import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { attachmentStorage } from "../src/services/storage";
import { cleanupTestUsers, createTestUser } from "./helpers/auth";

const app = createApp();

const createdProjectIds: string[] = [];
const createdTechPackIds: string[] = [];

afterAll(async () => {
  const attachments = await prisma.attachment.findMany({
    where: { techPackVersion: { techPackId: { in: createdTechPackIds } } },
    select: { id: true, storageKey: true },
  });
  await prisma.attachment.deleteMany({ where: { id: { in: attachments.map((a) => a.id) } } });
  await Promise.all(attachments.map((a) => attachmentStorage.delete(a.storageKey)));

  await prisma.protoRequest.deleteMany({
    where: { techPackVersion: { techPackId: { in: createdTechPackIds } } },
  });
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

  // Successors (supersedesId set) first - a single deleteMany covering both a
  // superseded TechPack and its successor in one statement would race its own
  // self-referencing FK; two separate statements don't.
  await prisma.techPack.deleteMany({
    where: { id: { in: createdTechPackIds }, supersedesId: { not: null } },
  });
  await prisma.techPack.deleteMany({ where: { id: { in: createdTechPackIds } } });

  await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

type Agent = Awaited<ReturnType<typeof createTestUser>>["agent"];

async function createProject(agent: Agent, body: Record<string, unknown> = {}) {
  const res = await agent
    .post("/projects")
    .send({ name: "Decision Host Project", productName: "Widget", ...body });
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

async function confirmVersion(agent: Agent, techPackId: string, versionNumber: number) {
  return agent.post(`/tech-packs/${techPackId}/versions/${versionNumber}/confirm`).send({});
}

async function decide(
  agent: Agent,
  techPackId: string,
  versionNumber: number | string,
  body: Record<string, unknown>,
) {
  const res = await agent
    .post(`/tech-packs/${techPackId}/versions/${versionNumber}/decision`)
    .send(body);
  if (res.status === 201 && res.body.techPack?.id) createdTechPackIds.push(res.body.techPack.id);
  return res;
}

async function setUpConfirmedVersion1() {
  const { agent: pmo } = await createTestUser(app, "PMO");
  const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
  const { agent: engineering } = await createTestUser(app, "ENGINEERING");
  const project = await createProject(pmo);
  const created = await createTechPack(designer, project.id);
  const techPackId = created.body.id as string;
  const techPackCode = created.body.code as string;
  const confirmed = await confirmVersion(engineering, techPackId, 1);
  expect(confirmed.status).toBe(201);
  return { designer, engineering, project, techPackId, techPackCode };
}

describe("POST /tech-packs/:id/versions/:versionNumber/decision", () => {
  it("approves a confirmed latest version, creating a pinned ProtoRequest", async () => {
    const { techPackId, techPackCode, project } = await setUpConfirmedVersion1();
    const { agent: management } = await createTestUser(app, "MANAGEMENT");

    const res = await decide(management, techPackId, 1, { decision: "APPROVED", notes: "looks good" });

    expect(res.status).toBe(201);
    expect(res.body.decision).toBe("APPROVED");
    expect(res.body.techPack.id).toBe(techPackId);
    expect(res.body.techPack.versions[0].approval).toMatchObject({ decision: "APPROVED", notes: "looks good" });

    const pr = res.body.protoRequest;
    expect(pr.code).toMatch(/^PR-\d{6,}$/);
    expect(pr.project.id).toBe(project.id);
    expect(pr.techPackVersion.versionNumber).toBe(1);
    expect(pr.techPackVersion.techPack.code).toBe(techPackCode);
  });

  it("rejects a confirmed latest version, voiding it and creating a successor", async () => {
    const { designer, techPackId, project } = await setUpConfirmedVersion1();
    const { agent: management } = await createTestUser(app, "MANAGEMENT");

    const res = await decide(management, techPackId, 1, {
      decision: "REJECTED",
      notes: "BOM is wrong",
    });

    expect(res.status).toBe(201);
    expect(res.body.decision).toBe("REJECTED");
    expect(res.body.protoRequest).toBeNull();

    const successor = res.body.techPack;
    expect(successor.id).not.toBe(techPackId);
    expect(successor.supersedes.id).toBe(techPackId);
    expect(successor.versions).toHaveLength(0);

    const original = await management.get(`/tech-packs/${techPackId}`);
    expect(original.body.voidedAt).not.toBeNull();
    expect(original.body.voidReason).toBe("BOM is wrong");
    expect(original.body.voidedBy.passwordHash).toBeUndefined();
    expect(original.body.supersededBy.id).toBe(successor.id);

    // The voided TechPack takes no further uploads or remarks.
    const blockedUpload = await uploadVersion(designer, techPackId);
    expect(blockedUpload.status).toBe(409);
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");
    const blockedRemark = await engineering
      .post(`/tech-packs/${techPackId}/versions/1/remarks`)
      .send({ body: "too late" });
    expect(blockedRemark.status).toBe(409);

    // The designer can upload v1 to the successor.
    const v1OnSuccessor = await uploadVersion(designer, successor.id);
    expect(v1OnSuccessor.status).toBe(201);
    expect(v1OnSuccessor.body.versions).toHaveLength(1);
    expect(v1OnSuccessor.body.versions[0].versionNumber).toBe(1);

    // The successor now counts as the Project's one active TechPack for this
    // phase: a second fresh create is refused.
    const secondCreate = await createTechPack(designer, project.id);
    expect(secondCreate.status).toBe(409);
  });

  it("requires notes when rejecting", async () => {
    const { techPackId } = await setUpConfirmedVersion1();
    const { agent: management } = await createTestUser(app, "MANAGEMENT");

    const missing = await decide(management, techPackId, 1, { decision: "REJECTED" });
    const blank = await decide(management, techPackId, 1, { decision: "REJECTED", notes: "   " });

    expect(missing.status).toBe(400);
    expect(blank.status).toBe(400);
  });

  it("does not require notes when approving", async () => {
    const { techPackId } = await setUpConfirmedVersion1();
    const { agent: management } = await createTestUser(app, "MANAGEMENT");

    const res = await decide(management, techPackId, 1, { decision: "APPROVED" });

    expect(res.status).toBe(201);
  });

  it.each([
    "FINANCE",
    "PMO",
    "PRODUCT_DESIGNER",
    "ENGINEERING",
    "MERCHANDISER",
    "ADMIN",
  ] as UserRole[])("forbids %s, including ADMIN (ADR 0009)", async (role) => {
    const { techPackId } = await setUpConfirmedVersion1();
    const { agent } = await createTestUser(app, role);

    const res = await decide(agent, techPackId, 1, { decision: "APPROVED" });

    expect(res.status).toBe(403);
  });

  it("404s an unknown TechPack id", async () => {
    const { agent: management } = await createTestUser(app, "MANAGEMENT");

    const res = await decide(management, "00000000-0000-0000-0000-000000000000", 1, {
      decision: "APPROVED",
    });

    expect(res.status).toBe(404);
  });

  it("404s an unknown version number", async () => {
    const { techPackId } = await setUpConfirmedVersion1();
    const { agent: management } = await createTestUser(app, "MANAGEMENT");

    const res = await decide(management, techPackId, 99, { decision: "APPROVED" });

    expect(res.status).toBe(404);
  });

  it("refuses to decide on a voided TechPack", async () => {
    const { techPackId } = await setUpConfirmedVersion1();
    const { agent: management } = await createTestUser(app, "MANAGEMENT");
    await prisma.techPack.update({
      where: { id: techPackId },
      data: { voidedAt: new Date(), voidReason: "test setup" },
    });

    const res = await decide(management, techPackId, 1, { decision: "APPROVED" });

    expect(res.status).toBe(409);
  });

  it("refuses to decide once the TechPack is already approved", async () => {
    const { techPackId } = await setUpConfirmedVersion1();
    const { agent: management } = await createTestUser(app, "MANAGEMENT");
    const first = await decide(management, techPackId, 1, { decision: "APPROVED" });
    expect(first.status).toBe(201);

    const second = await decide(management, techPackId, 1, {
      decision: "REJECTED",
      notes: "too late now",
    });

    expect(second.status).toBe(409);
  });

  it("refuses to decide on a version that is no longer the latest", async () => {
    const { designer, techPackId } = await setUpConfirmedVersion1();
    await uploadVersion(designer, techPackId);
    const { agent: management } = await createTestUser(app, "MANAGEMENT");

    const res = await decide(management, techPackId, 1, { decision: "APPROVED" });

    expect(res.status).toBe(409);
  });

  it("refuses to approve the latest version when only an earlier version is confirmed (ADR 0006)", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: engineering } = await createTestUser(app, "ENGINEERING");
    const { agent: management } = await createTestUser(app, "MANAGEMENT");
    const project = await createProject(pmo);
    const created = await createTechPack(designer, project.id);
    const techPackId = created.body.id as string;

    await uploadVersion(designer, techPackId); // v2
    const confirmV2 = await confirmVersion(engineering, techPackId, 2);
    expect(confirmV2.status).toBe(201);
    await uploadVersion(designer, techPackId); // v3, unconfirmed, now latest

    const res = await decide(management, techPackId, 3, { decision: "APPROVED" });

    expect(res.status).toBe(409);
  });

  it("never approves a non-latest version under a concurrent upload", async () => {
    const { designer, techPackId } = await setUpConfirmedVersion1();
    const { agent: management } = await createTestUser(app, "MANAGEMENT");

    const [approveResult, uploadResult] = await Promise.allSettled([
      decide(management, techPackId, 1, { decision: "APPROVED" }),
      uploadVersion(designer, techPackId),
    ]);

    const approveStatus = approveResult.status === "fulfilled" ? approveResult.value.status : -1;
    const uploadStatus = uploadResult.status === "fulfilled" ? uploadResult.value.status : -1;

    const successes = [approveStatus, uploadStatus].filter((status) => status === 201).length;
    expect(successes).toBe(1);
    if (approveStatus === 201) {
      // The approval landed on v1 first - uploadTechPackVersion's own
      // "already approved" check then blocks the upload.
      expect(uploadStatus).toBe(409);
    } else {
      // The upload made v2 the latest first - the approval, still targeting
      // v1, is refused as no-longer-latest rather than silently going through.
      expect(approveStatus).toBe(409);
    }
  });
});

describe("GET /proto-requests and /proto-requests/:id", () => {
  it("lists and reads back a ProtoRequest created by an approval", async () => {
    const { techPackId, techPackCode, project } = await setUpConfirmedVersion1();
    const { agent: management } = await createTestUser(app, "MANAGEMENT");
    const approved = await decide(management, techPackId, 1, { decision: "APPROVED" });
    const protoRequestId = approved.body.protoRequest.id;

    const { agent: finance } = await createTestUser(app, "FINANCE");
    const list = await finance.get("/proto-requests");
    expect(list.status).toBe(200);
    expect(list.body.some((pr: { id: string }) => pr.id === protoRequestId)).toBe(true);

    const detail = await finance.get(`/proto-requests/${protoRequestId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.project.id).toBe(project.id);
    expect(detail.body.techPackVersion.techPack.code).toBe(techPackCode);
    expect(detail.body.techPackVersion.versionNumber).toBe(1);
  });

  it("filters by projectId", async () => {
    const { techPackId: techPackIdA, project: projectA } = await setUpConfirmedVersion1();
    const { techPackId: techPackIdB } = await setUpConfirmedVersion1();
    const { agent: management } = await createTestUser(app, "MANAGEMENT");
    const approvedA = await decide(management, techPackIdA, 1, { decision: "APPROVED" });
    await decide(management, techPackIdB, 1, { decision: "APPROVED" });

    const { agent: finance } = await createTestUser(app, "FINANCE");
    const res = await finance.get(`/proto-requests?projectId=${projectA.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(approvedA.body.protoRequest.id);
  });

  it("404s an unknown (but well-formed) id", async () => {
    const { agent: finance } = await createTestUser(app, "FINANCE");

    const res = await finance.get("/proto-requests/00000000-0000-0000-0000-000000000000");

    expect(res.status).toBe(404);
  });
});
