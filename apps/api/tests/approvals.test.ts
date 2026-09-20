import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { cleanupTestUsers, createTestUser, type TestUser } from "./helpers/auth";

const app = createApp();

let admin: TestUser;
let owner: TestUser; // owns the products; deliberately only an ENGINEER
let assignedManager: TestUser;
let unrelatedManager: TestUser;
let assignee: TestUser;
let stranger: TestUser;

let finalStageId: string;
let finalReviewStageId: string;
let finalSequenceOrder: number;
const createdProductIds: string[] = [];

async function assign(productId: string, stageId: string, userId: string) {
  const res = await admin.agent.post(`/products/${productId}/assignments`).send({ stageId, userId });
  expect(res.status).toBe(201);
}

// Creates a product owned by `owner` and walks it forward to the stage just
// before Approval (Final Review), as the admin.
async function createProductAtFinalReview(): Promise<string> {
  const created = await admin.agent
    .post("/products")
    .send({ name: "Approval Test Widget", ownerId: owner.id, spec: "v1 spec" });
  expect(created.status).toBe(201);

  const productId = created.body.id as string;
  createdProductIds.push(productId);

  for (let order = 1; order < finalSequenceOrder - 1; order++) {
    const step = await admin.agent.post(`/products/${productId}/transition`).send({});
    expect(step.status).toBe(200);
  }
  return productId;
}

async function approvalsFor(productId: string) {
  return prisma.approval.findMany({ where: { productId }, orderBy: { decidedAt: "asc" } });
}

async function currentOrder(productId: string) {
  const res = await admin.agent.get(`/products/${productId}`);
  return res.body.currentStage.sequenceOrder as number;
}

beforeAll(async () => {
  const stages = await prisma.stageDefinition.findMany({ orderBy: { sequenceOrder: "asc" } });
  if (stages.length < 3) {
    throw new Error(
      "stage_definitions is empty or too short — run `npm run db:seed --workspace apps/api` before testing",
    );
  }
  finalSequenceOrder = stages[stages.length - 1].sequenceOrder;
  finalStageId = stages[stages.length - 1].id;
  finalReviewStageId = stages[stages.length - 2].id;

  admin = await createTestUser(app, "ADMIN");
  owner = await createTestUser(app, "ENGINEER", "owner");
  assignedManager = await createTestUser(app, "MANAGER", "assigned-manager");
  unrelatedManager = await createTestUser(app, "MANAGER", "unrelated-manager");
  assignee = await createTestUser(app, "ENGINEER", "assignee");
  stranger = await createTestUser(app, "ENGINEER", "stranger");
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

describe("Approval flow", () => {
  it("requires an approval decision to enter the Approval stage", async () => {
    const productId = await createProductAtFinalReview();

    const res = await admin.agent.post(`/products/${productId}/transition`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approval decision is required/i);
    expect(await currentOrder(productId)).toBe(finalSequenceOrder - 1);
    expect(await approvalsFor(productId)).toHaveLength(0);
  });

  it("moves forward into Approval and attributes the decision to the authenticated user", async () => {
    const productId = await createProductAtFinalReview();

    const res = await admin.agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "APPROVED", notes: "ship it" } });

    expect(res.status).toBe(200);
    expect(res.body.currentStage.sequenceOrder).toBe(finalSequenceOrder);
    expect(res.body.approvals).toHaveLength(1);
    expect(res.body.approvals[0]).toMatchObject({
      decision: "APPROVED",
      notes: "ship it",
      decidedBy: { id: admin.id },
      productVersion: { versionNumber: 1 },
    });
    expect(res.body.approvals[0].decidedBy.passwordHash).toBeUndefined();

    // Pinned to the exact version row and to the final stage.
    const [approval] = await approvalsFor(productId);
    const version = await prisma.productVersion.findFirstOrThrow({
      where: { productId, versionNumber: 1 },
    });
    expect(approval.productVersionId).toBe(version.id);
    expect(approval.stageId).toBe(finalStageId);
  });

  it("sends the product back a stage and records the decision when REJECTED", async () => {
    const productId = await createProductAtFinalReview();

    const res = await admin.agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "REJECTED", notes: "fails drop test" } });

    expect(res.status).toBe(200);
    expect(res.body.currentStage.sequenceOrder).toBe(finalSequenceOrder - 2);
    expect(res.body.approvals).toHaveLength(1);
    expect(res.body.approvals[0]).toMatchObject({
      decision: "REJECTED",
      notes: "fails drop test",
      decidedBy: { id: admin.id },
    });

    // The rejection notes are the backward reason on the stage it left.
    const leftStage = res.body.stageHistory.find(
      (entry: { stage: { sequenceOrder: number }; exitedAt: string | null }) =>
        entry.stage.sequenceOrder === finalSequenceOrder - 1 && entry.exitedAt !== null,
    );
    expect(leftStage.delayReason).toBe("fails drop test");
    // ...and the move is attributed to whoever pressed the button.
    expect(leftStage.exitedById).toBe(admin.id);
  });

  it("requires notes to reject", async () => {
    const productId = await createProductAtFinalReview();

    const res = await admin.agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "REJECTED" } });

    expect(res.status).toBe(400);
    expect(await approvalsFor(productId)).toHaveLength(0);
  });

  it("does not accept a decider in the request body", async () => {
    const productId = await createProductAtFinalReview();

    const res = await admin.agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "APPROVED", decidedById: stranger.id } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/decidedById is not accepted/);
    expect(await approvalsFor(productId)).toHaveLength(0);
  });

  it("rejects an invalid decision", async () => {
    const productId = await createProductAtFinalReview();

    const res = await admin.agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "MAYBE" } });

    expect(res.status).toBe(400);
    expect(await approvalsFor(productId)).toHaveLength(0);
  });

  it("rejects an approval sent with any other transition", async () => {
    const created = await admin.agent
      .post("/products")
      .send({ name: "Too Early Widget", ownerId: owner.id });
    const productId = created.body.id as string;
    createdProductIds.push(productId);

    const res = await admin.agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "APPROVED" } });

    expect(res.status).toBe(400);
    expect(await approvalsFor(productId)).toHaveLength(0);
  });

  it("keeps a rejection as history and pins a later approval to the newer version", async () => {
    const productId = await createProductAtFinalReview();

    await admin.agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "REJECTED", notes: "needs v2" } });

    const versioned = await admin.agent.post(`/products/${productId}/versions`).send({ spec: "v2 spec" });
    expect(versioned.status).toBe(201);

    // Modification -> Final Review, then approve.
    const back = await admin.agent.post(`/products/${productId}/transition`).send({});
    expect(back.status).toBe(200);
    const approved = await admin.agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "APPROVED" } });
    expect(approved.status).toBe(200);

    const [rejection, approval] = await approvalsFor(productId);
    const versions = await prisma.productVersion.findMany({ where: { productId } });
    const v1 = versions.find((v) => v.versionNumber === 1)!;
    const v2 = versions.find((v) => v.versionNumber === 2)!;

    expect(rejection).toMatchObject({ decision: "REJECTED", productVersionId: v1.id });
    expect(approval).toMatchObject({ decision: "APPROVED", productVersionId: v2.id });
  });
});

// ADR 0005 / ADR 0004 Resolution 7: an admin, the product's owner, or a manager
// assigned to the product may decide. Nobody else, and role alone is not enough.
describe("Who may decide an approval", () => {
  async function prepare() {
    const productId = await createProductAtFinalReview();
    await assign(productId, finalReviewStageId, assignedManager.id);
    await assign(productId, finalReviewStageId, assignee.id);
    return productId;
  }

  it.each([
    ["an admin", () => admin],
    ["the product's owner, even though their role is only ENGINEER", () => owner],
    ["a manager assigned to the product", () => assignedManager],
  ])("allows %s", async (_who, actor) => {
    const productId = await prepare();

    const res = await actor().agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "APPROVED" }, force: true });

    expect(res.status).toBe(200);
    const [approval] = await approvalsFor(productId);
    expect(approval.decidedById).toBe(actor().id);
  });

  it("forbids an assignee, who can see the product but holds no authority over it", async () => {
    const productId = await createProductAtFinalReview();
    // The sole assignee of the stage being left: exactly the person who *could*
    // otherwise advance it directly.
    await assign(productId, finalReviewStageId, assignee.id);

    const res = await assignee.agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "APPROVED" } });

    expect(res.status).toBe(403);
    expect(await approvalsFor(productId)).toHaveLength(0);
    expect(await currentOrder(productId)).toBe(finalSequenceOrder - 1);
  });

  it("forbids an assignee even when they try to advance without an approval", async () => {
    const productId = await createProductAtFinalReview();
    await assign(productId, finalReviewStageId, assignee.id);

    const res = await assignee.agent.post(`/products/${productId}/transition`).send({});

    expect(res.status).toBe(403);
    expect(await currentOrder(productId)).toBe(finalSequenceOrder - 1);
  });

  it.each([
    ["a manager with no tie to the product", () => unrelatedManager],
    ["a user with no relationship to the product", () => stranger],
  ])("hides the product from %s (404, and nothing is recorded)", async (_who, actor) => {
    const productId = await prepare();

    const res = await actor().agent
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "APPROVED" } });

    expect(res.status).toBe(404);
    expect(await approvalsFor(productId)).toHaveLength(0);
    expect(await currentOrder(productId)).toBe(finalSequenceOrder - 1);
  });
});
