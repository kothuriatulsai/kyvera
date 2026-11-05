import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { attachmentStorage } from "../src/services/storage";
import { cleanupTestUsers, createTestUser } from "./helpers/auth";
import { addMember } from "./helpers/membership";

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
  await prisma.techPack.deleteMany({
    where: { id: { in: createdTechPackIds }, supersedesId: { not: null } },
  });
  await prisma.techPack.deleteMany({ where: { id: { in: createdTechPackIds } } });
  await prisma.projectMemberHistory.deleteMany({ where: { projectId: { in: createdProjectIds } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: createdProjectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

type Agent = Awaited<ReturnType<typeof createTestUser>>["agent"];

async function createProject(agent: Agent) {
  const res = await agent.post("/projects").send({ name: "Tasks Host Project", productName: "Widget" });
  createdProjectIds.push(res.body.id);
  return res.body as { id: string; code: string };
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

function remark(agent: Agent, techPackId: string, versionNumber: number, body: string) {
  return agent.post(`/tech-packs/${techPackId}/versions/${versionNumber}/remarks`).send({ body });
}

function confirmVersion(agent: Agent, techPackId: string, versionNumber: number) {
  return agent.post(`/tech-packs/${techPackId}/versions/${versionNumber}/confirm`).send({});
}

function decide(agent: Agent, techPackId: string, versionNumber: number, body: Record<string, unknown>) {
  return agent.post(`/tech-packs/${techPackId}/versions/${versionNumber}/decision`).send(body);
}

interface Task {
  type: string;
  techPackId?: string;
  projectId: string;
}

async function tasksFor(agent: Agent): Promise<Task[]> {
  const res = await agent.get("/me/tasks");
  expect(res.status).toBe(200);
  return res.body as Task[];
}

function taskTypesFor(tasks: Task[], techPackId: string) {
  return tasks.filter((t) => t.techPackId === techPackId).map((t) => t.type);
}

describe("GET /me/tasks (ADR 0014)", () => {
  it.each(["ADMIN", "FINANCE", "MERCHANDISER"] as UserRole[])("is always empty for %s", async (role) => {
    const { agent } = await createTestUser(app, role);
    expect(await tasksFor(agent)).toEqual([]);
  });

  it("PRODUCT_DESIGNER: a non-member never gets a task for the Project at all (ADR 0013)", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: outsider } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);
    await addMember(project.id, designerId);
    await createTechPack(designer, project.id);

    expect(await tasksFor(outsider)).toEqual([]);
  });

  it("PRODUCT_DESIGNER sees 'Upload v1' for a successor created after a rejection", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: engineering, id: engineeringId } = await createTestUser(app, "ENGINEERING");
    const { agent: management } = await createTestUser(app, "MANAGEMENT");
    const project = await createProject(pmo);
    await addMember(project.id, designerId);
    await addMember(project.id, engineeringId);
    const created = await createTechPack(designer, project.id);
    const techPackId = created.body.id as string;
    expect((await confirmVersion(engineering, techPackId, 1)).status).toBe(201);

    const rejected = await decide(management, techPackId, 1, { decision: "REJECTED", notes: "redo the BOM" });
    expect(rejected.status).toBe(201);
    const successorId = rejected.body.techPack.id as string;
    createdTechPackIds.push(successorId);

    expect(taskTypesFor(await tasksFor(designer), successorId)).toEqual(["UPLOAD_FIRST_VERSION"]);
  });

  it("remark authorship decides whose turn it is: designer vs engineer tasks flip both ways", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: engineering, id: engineeringId } = await createTestUser(app, "ENGINEERING");
    const project = await createProject(pmo);
    await addMember(project.id, designerId);
    await addMember(project.id, engineeringId);
    const created = await createTechPack(designer, project.id);
    const techPackId = created.body.id as string;

    // Fresh upload, no remarks yet: Engineering has "Review", designer has nothing.
    expect(taskTypesFor(await tasksFor(engineering), techPackId)).toEqual(["REVIEW_VERSION"]);
    expect(taskTypesFor(await tasksFor(designer), techPackId)).toEqual([]);

    // Engineering leaves a remark: now it's the designer's turn, Engineering
    // is waiting and their own "Review" task is suppressed.
    expect((await remark(engineering, techPackId, 1, "please revise the BOM")).status).toBe(201);
    expect(taskTypesFor(await tasksFor(engineering), techPackId)).toEqual([]);
    expect(taskTypesFor(await tasksFor(designer), techPackId)).toEqual(["ADDRESS_REMARKS"]);

    // Designer replies: it's Engineering's turn again, designer's task clears.
    expect((await remark(designer, techPackId, 1, "fixed, please re-check")).status).toBe(201);
    expect(taskTypesFor(await tasksFor(engineering), techPackId)).toEqual(["REVIEW_VERSION"]);
    expect(taskTypesFor(await tasksFor(designer), techPackId)).toEqual([]);
  });

  it("ENGINEERING's 'Review' task clears once confirmed, and MANAGEMENT's 'Decide' appears in its place", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: engineering, id: engineeringId } = await createTestUser(app, "ENGINEERING");
    const { agent: management } = await createTestUser(app, "MANAGEMENT");
    const project = await createProject(pmo);
    await addMember(project.id, designerId);
    await addMember(project.id, engineeringId);
    const created = await createTechPack(designer, project.id);
    const techPackId = created.body.id as string;

    expect(taskTypesFor(await tasksFor(management), techPackId)).toEqual([]);

    expect((await confirmVersion(engineering, techPackId, 1)).status).toBe(201);

    expect(taskTypesFor(await tasksFor(engineering), techPackId)).toEqual([]);
    expect(taskTypesFor(await tasksFor(management), techPackId)).toEqual(["DECIDE_VERSION"]);

    // A newer, unconfirmed version hides Management's task again (the real
    // latest version isn't the one that's confirmed any more).
    expect((await uploadVersion(designer, techPackId)).status).toBe(201);
    expect(taskTypesFor(await tasksFor(management), techPackId)).toEqual([]);
    // ...and brings Engineering's "Review" back for the new version.
    expect(taskTypesFor(await tasksFor(engineering), techPackId)).toEqual(["REVIEW_VERSION"]);
  });

  it("MANAGEMENT's 'Decide' task clears once a decision is made", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: engineering, id: engineeringId } = await createTestUser(app, "ENGINEERING");
    const { agent: management } = await createTestUser(app, "MANAGEMENT");
    const project = await createProject(pmo);
    await addMember(project.id, designerId);
    await addMember(project.id, engineeringId);
    const created = await createTechPack(designer, project.id);
    const techPackId = created.body.id as string;
    expect((await confirmVersion(engineering, techPackId, 1)).status).toBe(201);
    expect(taskTypesFor(await tasksFor(management), techPackId)).toEqual(["DECIDE_VERSION"]);

    expect((await decide(management, techPackId, 1, { decision: "APPROVED" })).status).toBe(201);

    expect(taskTypesFor(await tasksFor(management), techPackId)).toEqual([]);
  });

  it("PMO's 'Waiting for design' clears the moment any TechPack exists on the Project", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);

    const beforeTypes = (await tasksFor(pmo)).filter((t) => t.projectId === project.id).map((t) => t.type);
    expect(beforeTypes).toEqual(["WAITING_FOR_DESIGN"]);

    await addMember(project.id, designerId);
    await createTechPack(designer, project.id);

    const afterTypes = (await tasksFor(pmo)).filter((t) => t.projectId === project.id).map((t) => t.type);
    expect(afterTypes).toEqual([]);
  });
});
