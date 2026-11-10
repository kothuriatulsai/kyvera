import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { cleanupSopFixtures } from "./helpers/cleanup";
import { createTestUser } from "./helpers/auth";
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
  const res = await agent.post("/projects").send({ name: "Proto Work Host Project", productName: "Widget" });
  createdProjectIds.push(res.body.id);
  return res.body as { id: string; code: string };
}

function notificationsFor(recipientId: string) {
  return prisma.notification.findMany({ where: { recipientId }, orderBy: { createdAt: "asc" } });
}

/** PMO, approved Tech Pack version 1, a fresh (unassigned) manufacturer, and
 * one member of each Slice A/B role - the fixture every test below builds on. */
async function setUpApprovedProtoRequest() {
  const { agent: pmo, id: pmoId } = await createTestUser(app, "PMO");
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

  const created = await designer
    .post("/tech-packs")
    .field("projectId", project.id)
    .attach("files", Buffer.from("tech pack bytes"), "spec.pdf");
  const techPackId = created.body.id as string;
  createdTechPackIds.push(techPackId);
  expect((await engineering.post(`/tech-packs/${techPackId}/versions/1/confirm`).send({})).status).toBe(201);
  const decided = await management
    .post(`/tech-packs/${techPackId}/versions/1/decision`)
    .send({ decision: "APPROVED" });
  expect(decided.status).toBe(201);
  const protoRequestId = decided.body.protoRequest.id as string;

  const manufacturer = await pmo.post("/manufacturers").send({ name: "Acme Fabrication" });
  expect(manufacturer.status).toBe(201);
  createdManufacturerIds.push(manufacturer.body.id);

  return {
    pmo,
    pmoId,
    designer,
    designerId,
    engineering,
    engineeringId,
    finance,
    financeId,
    merchandiser,
    merchandiserId,
    project,
    protoRequestId,
    manufacturerId: manufacturer.body.id as string,
  };
}

function assignManufacturer(agent: Agent, protoRequestId: string, manufacturerId: string) {
  return agent.post(`/proto-requests/${protoRequestId}/manufacturer`).send({ manufacturerId });
}

function uploadPo(agent: Agent, protoRequestId: string, filename = "po.pdf") {
  return agent
    .post(`/proto-requests/${protoRequestId}/po`)
    .attach("files", Buffer.from("purchase order bytes"), filename);
}

function confirmProtoRequest(agent: Agent, protoRequestId: string, body: Record<string, unknown> = {}) {
  return agent
    .post(`/proto-requests/${protoRequestId}/confirm`)
    .send({ agreedDeliveryDate: "2027-01-15", ...body });
}

/** Runs the whole Stage 4 flow and returns the resulting ProtoWork id. */
async function setUpQueuedProtoWork() {
  const fixture = await setUpApprovedProtoRequest();
  expect((await assignManufacturer(fixture.pmo, fixture.protoRequestId, fixture.manufacturerId)).status).toBe(201);
  expect((await uploadPo(fixture.finance, fixture.protoRequestId)).status).toBe(201);
  const confirmed = await confirmProtoRequest(fixture.pmo, fixture.protoRequestId);
  expect(confirmed.status).toBe(201);
  const protoWorkId = confirmed.body.protoWork.id as string;
  return { ...fixture, protoWorkId };
}

describe("POST /proto-requests/:id/manufacturer (Stage 4, step 15-16)", () => {
  it("PMO assigns a manufacturer and Finance is notified", async () => {
    const { pmo, financeId, protoRequestId, manufacturerId } = await setUpApprovedProtoRequest();

    const res = await assignManufacturer(pmo, protoRequestId, manufacturerId);

    expect(res.status).toBe(201);
    expect(res.body.manufacturer.id).toBe(manufacturerId);
    expect(res.body.manufacturerAssignedAt).not.toBeNull();

    const notifications = await notificationsFor(financeId);
    expect(notifications.filter((n) => n.type === "MANUFACTURER_ASSIGNED")).toHaveLength(1);
  });

  it("allows reassignment before confirmation", async () => {
    const { pmo, protoRequestId, manufacturerId } = await setUpApprovedProtoRequest();
    const second = await pmo.post("/manufacturers").send({ name: "Second Fabrication" });
    createdManufacturerIds.push(second.body.id);

    expect((await assignManufacturer(pmo, protoRequestId, manufacturerId)).status).toBe(201);
    const reassigned = await assignManufacturer(pmo, protoRequestId, second.body.id);
    expect(reassigned.status).toBe(201);
    expect(reassigned.body.manufacturer.id).toBe(second.body.id);
  });

  it.each(["FINANCE", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT", "MERCHANDISER"] as UserRole[])(
    "forbids %s",
    async (role) => {
      const { protoRequestId, manufacturerId } = await setUpApprovedProtoRequest();
      const { agent } = await createTestUser(app, role);

      const res = await assignManufacturer(agent, protoRequestId, manufacturerId);

      expect(res.status).toBe(403);
    },
  );

  it("409s once the Proto Request is confirmed", async () => {
    const fixture = await setUpQueuedProtoWork();

    const res = await assignManufacturer(fixture.pmo, fixture.protoRequestId, fixture.manufacturerId);

    expect(res.status).toBe(409);
  });

  it("404s a manufacturer that doesn't exist", async () => {
    const { pmo, protoRequestId } = await setUpApprovedProtoRequest();

    const res = await assignManufacturer(pmo, protoRequestId, "00000000-0000-0000-0000-000000000000");

    expect(res.status).toBe(404);
  });

  it("409s a deactivated manufacturer", async () => {
    const { pmo, protoRequestId, manufacturerId } = await setUpApprovedProtoRequest();
    expect((await pmo.post(`/manufacturers/${manufacturerId}/deactivate`)).status).toBe(200);

    const res = await assignManufacturer(pmo, protoRequestId, manufacturerId);

    expect(res.status).toBe(409);
    await pmo.post(`/manufacturers/${manufacturerId}/reactivate`);
  });
});

describe("POST /proto-requests/:id/po (Stage 4, step 17)", () => {
  it("Finance uploads the PO and PMO is notified", async () => {
    const { pmo, pmoId, finance, protoRequestId, manufacturerId } = await setUpApprovedProtoRequest();
    expect((await assignManufacturer(pmo, protoRequestId, manufacturerId)).status).toBe(201);

    const res = await uploadPo(finance, protoRequestId);

    expect(res.status).toBe(201);
    expect(res.body.poAttachment.originalName).toBe("po.pdf");

    const notifications = await notificationsFor(pmoId);
    expect(notifications.filter((n) => n.type === "PROTO_REQUEST_PO_UPLOADED")).toHaveLength(1);
  });

  it.each(["PMO", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT", "MERCHANDISER"] as UserRole[])(
    "forbids %s",
    async (role) => {
      const { protoRequestId } = await setUpApprovedProtoRequest();
      const { agent } = await createTestUser(app, role);

      const res = await uploadPo(agent, protoRequestId);

      expect(res.status).toBe(403);
    },
  );

  it("409s a second PO upload", async () => {
    const { finance, protoRequestId, pmo, manufacturerId } = await setUpApprovedProtoRequest();
    await assignManufacturer(pmo, protoRequestId, manufacturerId);
    expect((await uploadPo(finance, protoRequestId)).status).toBe(201);

    const second = await uploadPo(finance, protoRequestId, "po-v2.pdf");

    expect(second.status).toBe(409);
  });

  it("rejects more than one file", async () => {
    const { finance, protoRequestId } = await setUpApprovedProtoRequest();

    const res = await finance
      .post(`/proto-requests/${protoRequestId}/po`)
      .attach("files", Buffer.from("a"), "a.pdf")
      .attach("files", Buffer.from("b"), "b.pdf");

    expect(res.status).toBe(400);
  });

  it("requires a manufacturer to already be assigned before uploading a PO", async () => {
    const { finance, protoRequestId } = await setUpApprovedProtoRequest();

    const res = await uploadPo(finance, protoRequestId);

    expect(res.status).toBe(400);
  });
});

describe("POST /proto-requests/:id/confirm (Stage 4, step 19)", () => {
  it("requires a manufacturer before confirming", async () => {
    const { pmo, protoRequestId } = await setUpApprovedProtoRequest();

    const res = await confirmProtoRequest(pmo, protoRequestId);

    expect(res.status).toBe(400);
  });

  it("requires a PO before confirming", async () => {
    const { pmo, protoRequestId, manufacturerId } = await setUpApprovedProtoRequest();
    await assignManufacturer(pmo, protoRequestId, manufacturerId);

    const res = await confirmProtoRequest(pmo, protoRequestId);

    expect(res.status).toBe(400);
  });

  it("confirms, creates a queued ProtoWork, and notifies every other active PMO (not the confirming actor)", async () => {
    // A second PMO, created before confirming, so the one notification it
    // does or doesn't get is purely about this confirm, not a stray earlier
    // broadcast (PMO is see-all, so it needs no Project membership).
    const { id: otherPmoId } = await createTestUser(app, "PMO");

    const { pmoId } = await setUpQueuedProtoWork();

    expect((await notificationsFor(otherPmoId)).filter((n) => n.type === "PROTO_WORK_QUEUED")).toHaveLength(1);
    // The confirming PMO is the actor - never notified of their own action.
    expect((await notificationsFor(pmoId)).filter((n) => n.type === "PROTO_WORK_QUEUED")).toHaveLength(0);
  });

  it("the created ProtoWork has code PW-NNNNNN, status QUEUED, and the agreed delivery date", async () => {
    const { protoWorkId, pmo } = await setUpQueuedProtoWork();

    const res = await pmo.get(`/proto-work/${protoWorkId}`);

    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^PW-\d{6,}$/);
    expect(res.body.status).toBe("QUEUED");
    expect(res.body.currentDeliveryDate).toContain("2027-01-15");
  });

  it("409s a second confirm and does not create a second ProtoWork", async () => {
    const { pmo, protoRequestId } = await setUpQueuedProtoWork();

    const res = await confirmProtoRequest(pmo, protoRequestId);

    expect(res.status).toBe(409);
    const protoWorkCount = await prisma.protoWork.count({ where: { protoRequestId } });
    expect(protoWorkCount).toBe(1);
  });

  it.each(["FINANCE", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT", "MERCHANDISER"] as UserRole[])(
    "forbids %s",
    async (role) => {
      const { pmo, protoRequestId, manufacturerId, finance } = await setUpApprovedProtoRequest();
      await assignManufacturer(pmo, protoRequestId, manufacturerId);
      await uploadPo(finance, protoRequestId);
      const { agent } = await createTestUser(app, role);

      const res = await confirmProtoRequest(agent, protoRequestId);

      expect(res.status).toBe(403);
    },
  );
});

describe("GET /proto-work and /proto-work/:id - layer A visibility", () => {
  it("a Project member sees it; a non-member 404s", async () => {
    const { protoWorkId, project, merchandiser } = await setUpQueuedProtoWork();
    const { agent: outsider } = await createTestUser(app, "MERCHANDISER");

    const memberList = await merchandiser.get(`/proto-work?projectId=${project.id}`);
    expect(memberList.status).toBe(200);
    expect(memberList.body.some((pw: { id: string }) => pw.id === protoWorkId)).toBe(true);

    const outsiderList = await outsider.get(`/proto-work?projectId=${project.id}`);
    expect(outsiderList.body).toEqual([]);

    const outsiderDetail = await outsider.get(`/proto-work/${protoWorkId}`);
    expect(outsiderDetail.status).toBe(404);
  });

  it("404s an unknown id", async () => {
    const { pmo } = await setUpQueuedProtoWork();

    const res = await pmo.get("/proto-work/00000000-0000-0000-0000-000000000000");

    expect(res.status).toBe(404);
  });
});

describe("POST /proto-work/:id/assign (Stage 5, step 20)", () => {
  it("PMO assigns a merchandiser member and they're notified", async () => {
    const { pmo, protoWorkId, merchandiserId } = await setUpQueuedProtoWork();

    const res = await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ASSIGNED");
    expect(res.body.assignedMerchandiser.id).toBe(merchandiserId);

    const notifications = await notificationsFor(merchandiserId);
    expect(notifications.filter((n) => n.type === "PROTO_WORK_ASSIGNED")).toHaveLength(1);
  });

  it("400s a merchandiser who isn't a Project member", async () => {
    const { pmo, protoWorkId } = await setUpQueuedProtoWork();
    const { id: outsiderId } = await createTestUser(app, "MERCHANDISER");

    const res = await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId: outsiderId });

    expect(res.status).toBe(400);
  });

  it("400s a user who isn't a MERCHANDISER", async () => {
    const { pmo, protoWorkId, engineeringId } = await setUpQueuedProtoWork();

    const res = await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId: engineeringId });

    expect(res.status).toBe(400);
  });

  it.each(["FINANCE", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT", "MERCHANDISER"] as UserRole[])(
    "forbids %s",
    async (role) => {
      const { protoWorkId, merchandiserId } = await setUpQueuedProtoWork();
      const { agent } = await createTestUser(app, role);

      const res = await agent.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId });

      expect(res.status).toBe(403);
    },
  );
});

describe("POST /proto-work/:id/delivery-confirmations and /updates (Stage 5, step 21-22)", () => {
  async function setUpAssigned() {
    const fixture = await setUpQueuedProtoWork();
    const assigned = await fixture.pmo
      .post(`/proto-work/${fixture.protoWorkId}/assign`)
      .send({ merchandiserId: fixture.merchandiserId });
    expect(assigned.status).toBe(201);
    return fixture;
  }

  it("a MERCHANDISER reconfirms the delivery date, updating current state and appending history", async () => {
    const { merchandiser, protoWorkId } = await setUpAssigned();

    const res = await merchandiser
      .post(`/proto-work/${protoWorkId}/delivery-confirmations`)
      .send({ deliveryDate: "2027-02-01", notes: "manufacturer slipped a bit" });

    expect(res.status).toBe(201);
    expect(res.body.currentDeliveryDate).toContain("2027-02-01");
    expect(res.body.deliveryConfirmations).toHaveLength(1);
    expect(res.body.deliveryConfirmations[0].notes).toBe("manufacturer slipped a bit");
  });

  it.each(["PMO", "FINANCE", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT"] as UserRole[])(
    "forbids %s from reconfirming",
    async (role) => {
      const { protoWorkId } = await setUpAssigned();
      const { agent } = await createTestUser(app, role);

      const res = await agent.post(`/proto-work/${protoWorkId}/delivery-confirmations`).send({
        deliveryDate: "2027-02-01",
      });

      expect(res.status).toBe(403);
    },
  );

  it.each(["PMO", "ENGINEERING", "MERCHANDISER"] as UserRole[])(
    "%s may post a chat update, oldest first",
    async (role) => {
      const fixture = await setUpAssigned();
      const agents: Record<string, Agent> = {
        PMO: fixture.pmo,
        ENGINEERING: fixture.engineering,
        MERCHANDISER: fixture.merchandiser,
      };

      const first = await agents[role].post(`/proto-work/${fixture.protoWorkId}/updates`).send({
        body: "manufacturer confirmed start of production",
      });

      expect(first.status).toBe(201);
      expect(first.body.updates).toHaveLength(1);
      expect(first.body.updates[0].body).toBe("manufacturer confirmed start of production");
    },
  );

  it.each(["FINANCE", "PRODUCT_DESIGNER", "MANAGEMENT"] as UserRole[])("forbids %s from posting an update", async (role) => {
    const { protoWorkId } = await setUpAssigned();
    const { agent } = await createTestUser(app, role);

    const res = await agent.post(`/proto-work/${protoWorkId}/updates`).send({ body: "hello" });

    expect(res.status).toBe(403);
  });
});

describe("POST /proto-work/:id/complete (Stage 5, step 23)", () => {
  it("409s while still QUEUED (never assigned)", async () => {
    const { merchandiser, protoWorkId } = await setUpQueuedProtoWork();

    const res = await merchandiser.post(`/proto-work/${protoWorkId}/complete`);

    expect(res.status).toBe(409);
  });

  it("a MERCHANDISER completes an assigned ProtoWork and PMO is notified", async () => {
    const { pmo, pmoId, merchandiser, merchandiserId, protoWorkId } = await setUpQueuedProtoWork();
    expect((await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId })).status).toBe(201);

    const res = await merchandiser.post(`/proto-work/${protoWorkId}/complete`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.completedAt).not.toBeNull();

    const notifications = await notificationsFor(pmoId);
    expect(notifications.filter((n) => n.type === "PROTO_WORK_COMPLETED")).toHaveLength(1);
  });

  it("409s completing twice", async () => {
    const { pmo, merchandiser, merchandiserId, protoWorkId } = await setUpQueuedProtoWork();
    await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId });
    expect((await merchandiser.post(`/proto-work/${protoWorkId}/complete`)).status).toBe(201);

    const res = await merchandiser.post(`/proto-work/${protoWorkId}/complete`);

    expect(res.status).toBe(409);
  });

  it("409s a delivery confirmation, an update, or reassignment once completed", async () => {
    const { pmo, merchandiser, merchandiserId, protoWorkId } = await setUpQueuedProtoWork();
    await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId });
    expect((await merchandiser.post(`/proto-work/${protoWorkId}/complete`)).status).toBe(201);

    const confirmation = await merchandiser
      .post(`/proto-work/${protoWorkId}/delivery-confirmations`)
      .send({ deliveryDate: "2027-03-01" });
    expect(confirmation.status).toBe(409);

    const update = await merchandiser.post(`/proto-work/${protoWorkId}/updates`).send({ body: "too late" });
    expect(update.status).toBe(409);

    const reassign = await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId });
    expect(reassign.status).toBe(409);
  });

  it.each(["PMO", "FINANCE", "PRODUCT_DESIGNER", "ENGINEERING", "MANAGEMENT"] as UserRole[])(
    "forbids %s",
    async (role) => {
      const { pmo, merchandiserId, protoWorkId } = await setUpQueuedProtoWork();
      await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId });
      const { agent } = await createTestUser(app, role);

      const res = await agent.post(`/proto-work/${protoWorkId}/complete`);

      expect(res.status).toBe(403);
    },
  );
});

describe("Proto Work ownership - a second MERCHANDISER member is not the assignee (ADR 0015, revised)", () => {
  async function setUpAssignedWithSecondMerchandiser() {
    const fixture = await setUpQueuedProtoWork();
    const assigned = await fixture.pmo
      .post(`/proto-work/${fixture.protoWorkId}/assign`)
      .send({ merchandiserId: fixture.merchandiserId });
    expect(assigned.status).toBe(201);

    const { agent: secondMerchandiser, id: secondMerchandiserId } = await createTestUser(
      app,
      "MERCHANDISER",
      "merchandiser2",
    );
    await addMember(fixture.project.id, secondMerchandiserId);

    return { ...fixture, secondMerchandiser, secondMerchandiserId };
  }

  it("sees the Proto Work (layer A only) but is forbidden from reconfirming the delivery date", async () => {
    const { secondMerchandiser, protoWorkId } = await setUpAssignedWithSecondMerchandiser();

    const read = await secondMerchandiser.get(`/proto-work/${protoWorkId}`);
    expect(read.status).toBe(200);

    const res = await secondMerchandiser
      .post(`/proto-work/${protoWorkId}/delivery-confirmations`)
      .send({ deliveryDate: "2027-02-01" });

    expect(res.status).toBe(403);
  });

  it("is forbidden from posting an update", async () => {
    const { secondMerchandiser, protoWorkId } = await setUpAssignedWithSecondMerchandiser();

    const res = await secondMerchandiser.post(`/proto-work/${protoWorkId}/updates`).send({ body: "not my job" });

    expect(res.status).toBe(403);
  });

  it("is forbidden from completing it", async () => {
    const { secondMerchandiser, protoWorkId } = await setUpAssignedWithSecondMerchandiser();

    const res = await secondMerchandiser.post(`/proto-work/${protoWorkId}/complete`);

    expect(res.status).toBe(403);
  });

  it("the actually-assigned Merchandiser is unaffected by the second one's membership", async () => {
    const { merchandiser, protoWorkId } = await setUpAssignedWithSecondMerchandiser();

    const res = await merchandiser
      .post(`/proto-work/${protoWorkId}/delivery-confirmations`)
      .send({ deliveryDate: "2027-02-01" });

    expect(res.status).toBe(201);
  });
});
