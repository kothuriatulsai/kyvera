import { afterAll, describe, expect, it } from "vitest";
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
  const res = await agent
    .post("/projects")
    .send({ name: "Notifications Host Project", productName: "Widget" });
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

async function confirmVersion(agent: Agent, techPackId: string, versionNumber: number) {
  return agent.post(`/tech-packs/${techPackId}/versions/${versionNumber}/confirm`).send({});
}

function notificationsFor(recipientId: string) {
  return prisma.notification.findMany({ where: { recipientId }, orderBy: { createdAt: "asc" } });
}

describe("notifications (ADR 0014)", () => {
  it("a version upload notifies only the project's ENGINEERING members, not MANAGEMENT and not a non-member ENGINEERING", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { id: engineeringId } = await createTestUser(app, "ENGINEERING");
    const { id: outsideEngineeringId } = await createTestUser(app, "ENGINEERING");
    const { id: managementId } = await createTestUser(app, "MANAGEMENT");
    const project = await createProject(pmo);
    await addMember(project.id, designerId);
    await addMember(project.id, engineeringId);

    const created = await createTechPack(designer, project.id);
    expect(created.status).toBe(201);

    const engineeringNotifications = await notificationsFor(engineeringId);
    expect(engineeringNotifications).toHaveLength(1);
    expect(engineeringNotifications[0].type).toBe("TECH_PACK_VERSION_UPLOADED");
    expect(engineeringNotifications[0].link).toBe(`/tech-packs/${created.body.id}`);

    expect(await notificationsFor(outsideEngineeringId)).toHaveLength(0);
    expect(await notificationsFor(managementId)).toHaveLength(0);
  });

  it("a remark notifies both sides of the project's thread, minus whoever posted it", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: engineering, id: engineeringId } = await createTestUser(app, "ENGINEERING");
    const { id: managementId } = await createTestUser(app, "MANAGEMENT");
    const project = await createProject(pmo);
    await addMember(project.id, designerId);
    await addMember(project.id, engineeringId);
    const created = await createTechPack(designer, project.id);
    const techPackId = created.body.id as string;

    await engineering.post(`/tech-packs/${techPackId}/versions/1/remarks`).send({ body: "please revise" });

    // Engineering is also a project member, so the upload itself already
    // notified them (TECH_PACK_VERSION_UPLOADED) before this remark - the
    // thing to check is that their *own* remark didn't notify them again.
    expect(
      (await notificationsFor(engineeringId)).filter((n) => n.type === "TECH_PACK_REMARK_ADDED"),
    ).toHaveLength(0);
    const designerNotifications = await notificationsFor(designerId);
    expect(designerNotifications).toHaveLength(1);
    expect(designerNotifications[0].type).toBe("TECH_PACK_REMARK_ADDED");
    expect(await notificationsFor(managementId)).toHaveLength(0);

    await designer.post(`/tech-packs/${techPackId}/versions/1/remarks`).send({ body: "fixed" });

    // The designer's own remark notifies Engineering back, not themselves again.
    expect(await notificationsFor(designerId)).toHaveLength(1);
    expect(
      (await notificationsFor(engineeringId)).filter((n) => n.type === "TECH_PACK_REMARK_ADDED"),
    ).toHaveLength(1);
  });

  it("confirming notifies the project's Product Designer members and every active MANAGEMENT user, member or not", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: engineering, id: engineeringId } = await createTestUser(app, "ENGINEERING");
    const { id: managementId } = await createTestUser(app, "MANAGEMENT");
    const project = await createProject(pmo);
    await addMember(project.id, designerId);
    await addMember(project.id, engineeringId);
    const created = await createTechPack(designer, project.id);
    const techPackId = created.body.id as string;

    const confirmed = await confirmVersion(engineering, techPackId, 1);
    expect(confirmed.status).toBe(201);

    const designerNotifications = await notificationsFor(designerId);
    expect(designerNotifications).toHaveLength(1);
    expect(designerNotifications[0].type).toBe("TECH_PACK_VERSION_CONFIRMED");

    // MANAGEMENT is a see-all role (ADR 0013) - notified regardless of
    // Project membership, unlike PRODUCT_DESIGNER/ENGINEERING above.
    const managementNotifications = await notificationsFor(managementId);
    expect(managementNotifications).toHaveLength(1);
    expect(managementNotifications[0].type).toBe("TECH_PACK_VERSION_CONFIRMED");

    // Engineering was already notified once by the upload itself - the
    // thing to check is that confirming didn't notify them a second time.
    expect(
      (await notificationsFor(engineeringId)).filter((n) => n.type === "TECH_PACK_VERSION_CONFIRMED"),
    ).toHaveLength(0);
  });

  it("approving notifies the Product Designer members and every active PMO user; rejecting does the same", async () => {
    const { agent: pmo, id: pmoId } = await createTestUser(app, "PMO");
    const { id: otherPmoId } = await createTestUser(app, "PMO");
    const { agent: designer, id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const { agent: engineering, id: engineeringId } = await createTestUser(app, "ENGINEERING");
    const project = await createProject(pmo);
    await addMember(project.id, designerId);
    await addMember(project.id, engineeringId);
    const created = await createTechPack(designer, project.id);
    const techPackId = created.body.id as string;
    expect((await confirmVersion(engineering, techPackId, 1)).status).toBe(201);

    // Created only now, after confirming - TECH_PACK_VERSION_CONFIRMED's
    // "every active MANAGEMENT user" fan-out ran before they existed, so
    // the one notification they do or don't get below is purely about the
    // decision itself, not a stray earlier broadcast.
    const { agent: management, id: managementId } = await createTestUser(app, "MANAGEMENT");

    const approved = await management
      .post(`/tech-packs/${techPackId}/versions/1/decision`)
      .send({ decision: "APPROVED" });
    expect(approved.status).toBe(201);

    const designerAfterApproval = await notificationsFor(designerId);
    expect(designerAfterApproval.map((n) => n.type)).toContain("TECH_PACK_VERSION_APPROVED");
    expect(await notificationsFor(otherPmoId)).toHaveLength(1);
    // The Project's own creator (pmo) is also an active PMO user, but
    // wasn't the actor here, so they're notified like any other PMO.
    expect((await notificationsFor(pmoId)).map((n) => n.type)).toContain("TECH_PACK_VERSION_APPROVED");
    expect(await notificationsFor(managementId)).toHaveLength(0);

    // A second TechPack, rejected this time - on a second Project, since a
    // Project allows only one active (non-voided) TechPack per phase and
    // the first one here is now approved, not voided.
    const project2 = await createProject(pmo);
    await addMember(project2.id, designerId);
    await addMember(project2.id, engineeringId);
    const created2 = await createTechPack(designer, project2.id);
    expect(created2.status).toBe(201);
    const techPackId2 = created2.body.id as string;
    expect((await confirmVersion(engineering, techPackId2, 1)).status).toBe(201);
    const rejected = await management
      .post(`/tech-packs/${techPackId2}/versions/1/decision`)
      .send({ decision: "REJECTED", notes: "needs rework" });
    expect(rejected.status).toBe(201);
    createdTechPackIds.push(rejected.body.techPack.id);

    const designerAfterRejection = await notificationsFor(designerId);
    expect(designerAfterRejection.map((n) => n.type)).toContain("TECH_PACK_VERSION_REJECTED");
    const rejectionNotification = designerAfterRejection.find((n) => n.type === "TECH_PACK_VERSION_REJECTED");
    expect(rejectionNotification?.link).toBe(`/tech-packs/${rejected.body.techPack.id}`);
  });

  it("adding a member notifies them with a link into the Project; removing notifies them with none", async () => {
    const { agent: pmo } = await createTestUser(app, "PMO");
    const { id: designerId } = await createTestUser(app, "PRODUCT_DESIGNER");
    const project = await createProject(pmo);

    const added = await pmo.post(`/projects/${project.id}/members`).send({ userId: designerId });
    expect(added.status).toBe(201);
    const afterAdd = await notificationsFor(designerId);
    expect(afterAdd).toHaveLength(1);
    expect(afterAdd[0].type).toBe("PROJECT_MEMBER_ADDED");
    expect(afterAdd[0].link).toBe(`/projects/${project.id}`);

    const removed = await pmo.post(`/projects/${project.id}/members/${designerId}/remove`);
    expect(removed.status).toBe(204);
    const afterRemove = await notificationsFor(designerId);
    expect(afterRemove).toHaveLength(2);
    const removal = afterRemove[1];
    expect(removal.type).toBe("PROJECT_MEMBER_REMOVED");
    expect(removal.link).toBe("/");
    expect(removal.message).toContain(project.code);
  });

  describe("Slice B (ADR 0015)", () => {
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
      const created = await createTechPack(designer, project.id);
      const techPackId = created.body.id as string;
      await confirmVersion(engineering, techPackId, 1);
      const decided = await management
        .post(`/tech-packs/${techPackId}/versions/1/decision`)
        .send({ decision: "APPROVED" });
      expect(decided.status).toBe(201);

      const manufacturer = await pmo.post("/manufacturers").send({ name: "Acme Fabrication" });
      createdManufacturerIds.push(manufacturer.body.id);

      return {
        pmo,
        pmoId,
        finance,
        financeId,
        merchandiser,
        merchandiserId,
        protoRequestId: decided.body.protoRequest.id as string,
        manufacturerId: manufacturer.body.id as string,
      };
    }

    it("assigning a manufacturer notifies the project's FINANCE members", async () => {
      const { pmo, financeId, protoRequestId, manufacturerId } = await setUpApprovedProtoRequest();

      const res = await pmo.post(`/proto-requests/${protoRequestId}/manufacturer`).send({ manufacturerId });
      expect(res.status).toBe(201);

      const notifications = await notificationsFor(financeId);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe("MANUFACTURER_ASSIGNED");
      expect(notifications[0].link).toBe(`/proto-requests/${protoRequestId}`);
    });

    it("uploading the PO notifies every active PMO user, not the uploading Finance actor", async () => {
      const { pmo, pmoId, finance, financeId, protoRequestId, manufacturerId } = await setUpApprovedProtoRequest();
      await pmo.post(`/proto-requests/${protoRequestId}/manufacturer`).send({ manufacturerId });

      const res = await finance
        .post(`/proto-requests/${protoRequestId}/po`)
        .attach("files", Buffer.from("po bytes"), "po.pdf");
      expect(res.status).toBe(201);

      const pmoNotifications = await notificationsFor(pmoId);
      expect(pmoNotifications.filter((n) => n.type === "PROTO_REQUEST_PO_UPLOADED")).toHaveLength(1);
      expect(await notificationsFor(financeId)).toHaveLength(1); // only MANUFACTURER_ASSIGNED from earlier
    });

    it("confirming notifies every other active PMO user, not the confirming actor", async () => {
      const { id: otherPmoId } = await createTestUser(app, "PMO");
      const { pmo, pmoId, finance, protoRequestId, manufacturerId } = await setUpApprovedProtoRequest();
      await pmo.post(`/proto-requests/${protoRequestId}/manufacturer`).send({ manufacturerId });
      await finance.post(`/proto-requests/${protoRequestId}/po`).attach("files", Buffer.from("po"), "po.pdf");

      const res = await pmo
        .post(`/proto-requests/${protoRequestId}/confirm`)
        .send({ agreedDeliveryDate: "2027-01-15" });
      expect(res.status).toBe(201);
      const protoWorkId = res.body.protoWork.id as string;

      // otherPmoId already got one TECH_PACK_VERSION_APPROVED notification
      // from setUpApprovedProtoRequest's own approval step (PMO is a
      // recipient of that event too) - filter to the one this test cares about.
      const queuedNotifications = (await notificationsFor(otherPmoId)).filter(
        (n) => n.type === "PROTO_WORK_QUEUED",
      );
      expect(queuedNotifications).toHaveLength(1);
      expect(queuedNotifications[0].link).toBe(`/proto-work/${protoWorkId}`);
      expect((await notificationsFor(pmoId)).filter((n) => n.type === "PROTO_WORK_QUEUED")).toHaveLength(0);
    });

    it("assigning to a merchandiser notifies exactly that merchandiser", async () => {
      const { pmo, finance, merchandiserId, protoRequestId, manufacturerId } = await setUpApprovedProtoRequest();
      await pmo.post(`/proto-requests/${protoRequestId}/manufacturer`).send({ manufacturerId });
      await finance.post(`/proto-requests/${protoRequestId}/po`).attach("files", Buffer.from("po"), "po.pdf");
      const confirmed = await pmo
        .post(`/proto-requests/${protoRequestId}/confirm`)
        .send({ agreedDeliveryDate: "2027-01-15" });
      const protoWorkId = confirmed.body.protoWork.id as string;

      const res = await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId });
      expect(res.status).toBe(201);

      const notifications = await notificationsFor(merchandiserId);
      expect(notifications.filter((n) => n.type === "PROTO_WORK_ASSIGNED")).toHaveLength(1);
    });

    it("completing notifies every active PMO user; a routine delivery-date reconfirmation notifies nobody", async () => {
      const { pmo, pmoId, finance, merchandiser, merchandiserId, protoRequestId, manufacturerId } =
        await setUpApprovedProtoRequest();
      await pmo.post(`/proto-requests/${protoRequestId}/manufacturer`).send({ manufacturerId });
      await finance.post(`/proto-requests/${protoRequestId}/po`).attach("files", Buffer.from("po"), "po.pdf");
      const confirmed = await pmo
        .post(`/proto-requests/${protoRequestId}/confirm`)
        .send({ agreedDeliveryDate: "2027-01-15" });
      const protoWorkId = confirmed.body.protoWork.id as string;
      await pmo.post(`/proto-work/${protoWorkId}/assign`).send({ merchandiserId });

      const beforeReconfirm = await prisma.notification.count();
      const reconfirmed = await merchandiser
        .post(`/proto-work/${protoWorkId}/delivery-confirmations`)
        .send({ deliveryDate: "2027-02-01" });
      expect(reconfirmed.status).toBe(201);
      expect(await prisma.notification.count()).toBe(beforeReconfirm);

      const completed = await merchandiser.post(`/proto-work/${protoWorkId}/complete`);
      expect(completed.status).toBe(201);

      const pmoNotifications = await notificationsFor(pmoId);
      expect(pmoNotifications.filter((n) => n.type === "PROTO_WORK_COMPLETED")).toHaveLength(1);
    });
  });

  describe("GET /me/notifications and friends", () => {
    async function seedTwoNotifications() {
      const { agent: pmo } = await createTestUser(app, "PMO");
      const { agent: recipient, id: recipientId } = await createTestUser(app, "PRODUCT_DESIGNER");
      const project = await createProject(pmo);
      await pmo.post(`/projects/${project.id}/members`).send({ userId: recipientId });
      await pmo.post(`/projects/${project.id}/members/${recipientId}/remove`);
      return { recipient, recipientId, project };
    }

    it("lists newest first, reports the unread count, and marking one read clears just that one", async () => {
      const { recipient, recipientId } = await seedTwoNotifications();

      const unreadBefore = await recipient.get("/me/notifications/unread-count");
      expect(unreadBefore.body.count).toBe(2);

      const list = await recipient.get("/me/notifications");
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(2);
      expect(list.body.items[0].type).toBe("PROJECT_MEMBER_REMOVED");
      expect(list.body.items[0].readAt).toBeNull();

      const markRes = await recipient.post(`/me/notifications/${list.body.items[0].id}/read`);
      expect(markRes.status).toBe(204);

      const afterMark = await prisma.notification.findMany({
        where: { recipientId },
        orderBy: { createdAt: "asc" },
      });
      expect(afterMark.filter((n) => n.readAt !== null)).toHaveLength(1);

      const unreadAfter = await recipient.get("/me/notifications/unread-count");
      expect(unreadAfter.body.count).toBe(1);
    });

    it("mark-all-read clears every unread notification for that recipient only", async () => {
      const { recipient, recipientId } = await seedTwoNotifications();

      const res = await recipient.post("/me/notifications/read-all");
      expect(res.status).toBe(204);

      const unread = await prisma.notification.count({ where: { recipientId, readAt: null } });
      expect(unread).toBe(0);
    });

    it("404s marking a notification that belongs to someone else", async () => {
      const { recipientId } = await seedTwoNotifications();
      const { agent: stranger } = await createTestUser(app, "PRODUCT_DESIGNER");
      const theirs = await prisma.notification.findFirstOrThrow({ where: { recipientId } });

      const res = await stranger.post(`/me/notifications/${theirs.id}/read`);

      expect(res.status).toBe(404);
    });
  });
});
