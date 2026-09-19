import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { authedAgent } from "./helpers/auth";

const app = createApp();
const api = authedAgent(app);

let managerId: string;
let adminId: string;
let engineerId: string;
let finalSequenceOrder: number;
const createdProductIds: string[] = [];
const createdUserIds: string[] = [];

async function createUser(name: string, role: "ADMIN" | "MANAGER" | "ENGINEER") {
  const user = await prisma.user.create({
    data: {
      name,
      email: `test-${role.toLowerCase()}-${randomUUID()}@kyvera.test`,
      role,
      passwordHash: "test",
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

// Creates a product and walks it forward to the stage just before Approval.
async function createProductAtFinalReview(): Promise<string> {
  const created = await api
    .post("/products")
    .send({ name: "Approval Test Widget", ownerId: managerId, spec: "v1 spec" });
  expect(created.status).toBe(201);

  const productId = created.body.id as string;
  createdProductIds.push(productId);

  for (let order = 1; order < finalSequenceOrder - 1; order++) {
    const step = await api.post(`/products/${productId}/transition`).send({});
    expect(step.status).toBe(200);
  }
  return productId;
}

async function approvalsFor(productId: string) {
  return prisma.approval.findMany({ where: { productId }, orderBy: { decidedAt: "asc" } });
}

beforeAll(async () => {
  const stages = await prisma.stageDefinition.findMany({ orderBy: { sequenceOrder: "asc" } });
  if (stages.length < 3) {
    throw new Error(
      "stage_definitions is empty or too short — run `npm run db:seed --workspace apps/api` before testing",
    );
  }
  finalSequenceOrder = stages[stages.length - 1].sequenceOrder;

  managerId = await createUser("Approval Test Manager", "MANAGER");
  adminId = await createUser("Approval Test Admin", "ADMIN");
  engineerId = await createUser("Approval Test Engineer", "ENGINEER");
});

afterAll(async () => {
  // Products first: their approvals cascade, and approvals.decided_by would
  // otherwise block deleting the users.
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("Approval flow", () => {
  it("requires an approval decision to enter the Approval stage", async () => {
    const productId = await createProductAtFinalReview();

    const res = await api.post(`/products/${productId}/transition`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approval decision is required/i);

    const product = await api.get(`/products/${productId}`);
    expect(product.body.currentStage.sequenceOrder).toBe(finalSequenceOrder - 1);
    expect(await approvalsFor(productId)).toHaveLength(0);
  });

  it("moves forward into Approval and records the decision when APPROVED", async () => {
    const productId = await createProductAtFinalReview();

    const res = await api
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "APPROVED", decidedById: adminId, notes: "ship it" } });

    expect(res.status).toBe(200);
    expect(res.body.currentStage.sequenceOrder).toBe(finalSequenceOrder);
    expect(res.body.approvals).toHaveLength(1);
    expect(res.body.approvals[0]).toMatchObject({
      decision: "APPROVED",
      notes: "ship it",
      decidedBy: { id: adminId },
      productVersion: { versionNumber: 1 },
    });
    expect(res.body.approvals[0].decidedBy.passwordHash).toBeUndefined();

    // Pinned to the exact version row and to the final stage.
    const [approval] = await approvalsFor(productId);
    const version = await prisma.productVersion.findFirstOrThrow({
      where: { productId, versionNumber: 1 },
    });
    const finalStage = await prisma.stageDefinition.findUniqueOrThrow({
      where: { sequenceOrder: finalSequenceOrder },
    });
    expect(approval.productVersionId).toBe(version.id);
    expect(approval.stageId).toBe(finalStage.id);
  });

  it("sends the product back a stage and records the decision when REJECTED", async () => {
    const productId = await createProductAtFinalReview();

    const res = await api
      .post(`/products/${productId}/transition`)
      .send({
        approval: { decision: "REJECTED", decidedById: managerId, notes: "fails drop test" },
      });

    expect(res.status).toBe(200);
    expect(res.body.currentStage.sequenceOrder).toBe(finalSequenceOrder - 2);
    expect(res.body.approvals).toHaveLength(1);
    expect(res.body.approvals[0]).toMatchObject({
      decision: "REJECTED",
      notes: "fails drop test",
    });

    // The rejection notes are the backward reason on the stage it left.
    const leftStage = res.body.stageHistory.find(
      (entry: { stage: { sequenceOrder: number }; exitedAt: string | null }) =>
        entry.stage.sequenceOrder === finalSequenceOrder - 1 && entry.exitedAt !== null,
    );
    expect(leftStage.delayReason).toBe("fails drop test");
  });

  it("requires notes to reject", async () => {
    const productId = await createProductAtFinalReview();

    const res = await api
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "REJECTED", decidedById: managerId } });

    expect(res.status).toBe(400);
    expect(await approvalsFor(productId)).toHaveLength(0);
  });

  it("returns 403 when a non-admin/manager submits a decision", async () => {
    const productId = await createProductAtFinalReview();

    const res = await api
      .post(`/products/${productId}/transition`)
      .send({
        approval: { decision: "REJECTED", decidedById: engineerId, notes: "not my call" },
      });

    expect(res.status).toBe(403);

    // Nothing moved and nothing was recorded.
    const product = await api.get(`/products/${productId}`);
    expect(product.body.currentStage.sequenceOrder).toBe(finalSequenceOrder - 1);
    expect(await approvalsFor(productId)).toHaveLength(0);
  });

  it("rejects an unknown decider and an invalid decision", async () => {
    const productId = await createProductAtFinalReview();

    const unknown = await api
      .post(`/products/${productId}/transition`)
      .send({
        approval: {
          decision: "APPROVED",
          decidedById: "00000000-0000-0000-0000-000000000000",
        },
      });
    expect(unknown.status).toBe(400);

    const invalid = await api
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "MAYBE", decidedById: adminId } });
    expect(invalid.status).toBe(400);

    expect(await approvalsFor(productId)).toHaveLength(0);
  });

  it("rejects an approval sent with any other transition", async () => {
    const created = await api
      .post("/products")
      .send({ name: "Too Early Widget", ownerId: managerId });
    const productId = created.body.id as string;
    createdProductIds.push(productId);

    const res = await api
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "APPROVED", decidedById: adminId } });

    expect(res.status).toBe(400);
    expect(await approvalsFor(productId)).toHaveLength(0);
  });

  it("keeps a rejection as history and pins a later approval to the newer version", async () => {
    const productId = await createProductAtFinalReview();

    await api
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "REJECTED", decidedById: adminId, notes: "needs v2" } });

    const versioned = await api
      .post(`/products/${productId}/versions`)
      .send({ spec: "v2 spec" });
    expect(versioned.status).toBe(201);

    // Modification -> Final Review, then approve.
    const back = await api.post(`/products/${productId}/transition`).send({});
    expect(back.status).toBe(200);
    const approved = await api
      .post(`/products/${productId}/transition`)
      .send({ approval: { decision: "APPROVED", decidedById: adminId } });
    expect(approved.status).toBe(200);

    const [rejection, approval] = await approvalsFor(productId);
    const versions = await prisma.productVersion.findMany({ where: { productId } });
    const v1 = versions.find((v) => v.versionNumber === 1)!;
    const v2 = versions.find((v) => v.versionNumber === 2)!;

    expect(rejection).toMatchObject({ decision: "REJECTED", productVersionId: v1.id });
    expect(approval).toMatchObject({ decision: "APPROVED", productVersionId: v2.id });
  });
});
