import { afterAll, describe, expect, it } from "vitest";
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
