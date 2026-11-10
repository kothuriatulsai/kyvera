import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { createTestUser } from "./helpers/auth";
import { cleanupSopFixtures } from "./helpers/cleanup";
import { addMember } from "./helpers/membership";

const app = createApp();

const createdProjectIds: string[] = [];
const createdTechPackIds: string[] = [];
const createdManufacturerIds: string[] = [];

afterAll(async () => {
  await cleanupSopFixtures({
    projectIds: createdProjectIds,
    techPackIds: createdTechPackIds,
    manufacturerIds: createdManufacturerIds,
  });
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
  protoRequestId?: string;
  protoWorkId?: string;
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
  it("is always empty for ADMIN (ADR 0015 adds Slice B tasks for FINANCE/MERCHANDISER instead)", async () => {
    const { agent } = await createTestUser(app, "ADMIN");
    expect(await tasksFor(agent)).toEqual([]);
  });

  it.each(["FINANCE", "MERCHANDISER"] as UserRole[])("is empty for a fresh %s with no fixtures", async (role) => {
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

describe("GET /me/tasks - Slice B (ADR 0015)", () => {
  async function approveTechPack() {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: engineering, id: engineeringId } = await createTestUser(app, "ENGINEERING");
    const { agent: management } = await createTestUser(app, "MANAGEMENT");
    const { agent: finance, id: financeId } = await createTestUser(app, "FINANCE");
    const { agent: merchandiser, id: merchandiserId } = await createTestUser(app, "MERCHANDISER");
    const project = await createProject(pmo);
    await addMember(project.id, designerId);
    await addMember(project.id, engineeringId);
    await addMember(project.id, financeId);
    await addMember(project.id, merchandiserId);
    const created = await createTechPack(designer, project.id);
    const techPackId = created.body.id as string;
    expect((await confirmVersion(engineering, techPackId, 1)).status).toBe(201);
    const decided = await decide(management, techPackId, 1, { decision: "APPROVED" });
    expect(decided.status).toBe(201);
    return { pmo, finance, financeId, merchandiser, merchandiserId, protoRequestId: decided.body.protoRequest.id as string };
  }

  async function assignManufacturer(pmo: Agent, protoRequestId: string) {
    const manufacturer = await pmo.post("/manufacturers").send({ name: "Acme Fabrication" });
    createdManufacturerIds.push(manufacturer.body.id);
    const res = await pmo.post(`/proto-requests/${protoRequestId}/manufacturer`).send({
      manufacturerId: manufacturer.body.id,
    });
    expect(res.status).toBe(201);
  }

  it("PMO sees 'Assign manufacturer' for a freshly approved Proto Request", async () => {
    const { pmo, protoRequestId } = await approveTechPack();

    const types = (await tasksFor(pmo))
      .filter((t) => t.protoRequestId === protoRequestId)
      .map((t) => t.type);

    expect(types).toEqual(["ASSIGN_MANUFACTURER"]);
  });

  it("FINANCE sees 'Upload PO' once a manufacturer is assigned; PMO's task becomes 'Confirm' once it's uploaded", async () => {
    const { pmo, finance, protoRequestId } = await approveTechPack();
    await assignManufacturer(pmo, protoRequestId);

    expect(
      (await tasksFor(finance)).filter((t) => t.protoRequestId === protoRequestId).map((t) => t.type),
    ).toEqual(["UPLOAD_PO"]);
    // PMO's own task has already cleared (manufacturer assigned) and hasn't
    // appeared again yet (no PO to confirm) - nothing for them to do here.
    expect((await tasksFor(pmo)).filter((t) => t.protoRequestId === protoRequestId)).toEqual([]);

    const uploaded = await finance
      .post(`/proto-requests/${protoRequestId}/po`)
      .attach("files", Buffer.from("po bytes"), "po.pdf");
    expect(uploaded.status).toBe(201);

    expect((await tasksFor(finance)).filter((t) => t.protoRequestId === protoRequestId)).toEqual([]);
    expect(
      (await tasksFor(pmo)).filter((t) => t.protoRequestId === protoRequestId).map((t) => t.type),
    ).toEqual(["CONFIRM_PROTO_REQUEST"]);
  });

  it("PMO sees 'Assign merchandiser' once confirmed, clearing once assigned", async () => {
    const { pmo, finance, merchandiserId, protoRequestId } = await approveTechPack();
    await assignManufacturer(pmo, protoRequestId);
    await finance.post(`/proto-requests/${protoRequestId}/po`).attach("files", Buffer.from("po bytes"), "po.pdf");
    const confirmed = await pmo
      .post(`/proto-requests/${protoRequestId}/confirm`)
      .send({ agreedDeliveryDate: "2027-01-15" });
    expect(confirmed.status).toBe(201);
    const protoWorkId = confirmed.body.protoWork.id as string;

    expect(
      (await tasksFor(pmo)).filter((t) => t.protoWorkId === protoWorkId).map((t) => t.type),
    ).toEqual(["ASSIGN_MERCHANDISER"]);

    const assigned = await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId });
    expect(assigned.status).toBe(201);

    expect((await tasksFor(pmo)).filter((t) => t.protoWorkId === protoWorkId)).toEqual([]);
  });

  it("MERCHANDISER sees 'Reconfirm delivery date' once the reconfirmation interval has elapsed, clearing on a fresh confirmation", async () => {
    const { pmo, finance, merchandiser, merchandiserId, protoRequestId } = await approveTechPack();
    await assignManufacturer(pmo, protoRequestId);
    await finance.post(`/proto-requests/${protoRequestId}/po`).attach("files", Buffer.from("po bytes"), "po.pdf");
    const confirmed = await pmo
      .post(`/proto-requests/${protoRequestId}/confirm`)
      .send({ agreedDeliveryDate: "2027-01-15" });
    const protoWorkId = confirmed.body.protoWork.id as string;
    await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId });

    // Freshly assigned - not stale yet.
    expect((await tasksFor(merchandiser)).filter((t) => t.protoWorkId === protoWorkId)).toEqual([]);

    // Back-date the assignment past the 7-day reconfirmation interval
    // (taskService.DELIVERY_RECONFIRMATION_INTERVAL_DAYS) - direct write,
    // bypassing the API, since nothing in the API moves time.
    const staleAssignedAt = new Date();
    staleAssignedAt.setDate(staleAssignedAt.getDate() - 8);
    await prisma.protoWork.update({ where: { id: protoWorkId }, data: { assignedAt: staleAssignedAt } });

    expect(
      (await tasksFor(merchandiser)).filter((t) => t.protoWorkId === protoWorkId).map((t) => t.type),
    ).toEqual(["RECONFIRM_DELIVERY_DATE"]);

    const reconfirmed = await merchandiser
      .post(`/proto-work/${protoWorkId}/delivery-confirmations`)
      .send({ deliveryDate: "2027-02-01" });
    expect(reconfirmed.status).toBe(201);

    expect((await tasksFor(merchandiser)).filter((t) => t.protoWorkId === protoWorkId)).toEqual([]);
  });
});
