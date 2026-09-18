import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";

const app = createApp();

let ownerId: string;
let responsibleUserId: string;

beforeAll(async () => {
  const stageCount = await prisma.stageDefinition.count();
  if (stageCount === 0) {
    throw new Error(
      "stage_definitions is empty — run `npm run db:seed --workspace apps/api` before testing",
    );
  }

  const owner = await prisma.user.create({
    data: {
      name: "Integration Test Owner",
      email: `test-owner-${randomUUID()}@kyvera.test`,
      role: "MANAGER",
      passwordHash: "test",
    },
  });
  ownerId = owner.id;

  const responsible = await prisma.user.create({
    data: {
      name: "Integration Test Engineer",
      email: `test-engineer-${randomUUID()}@kyvera.test`,
      role: "ENGINEER",
      passwordHash: "test",
    },
  });
  responsibleUserId = responsible.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, responsibleUserId] } } });
  await prisma.$disconnect();
});

describe("Product API", () => {
  let productId: string;

  it("creates a product with an initial version and stage history entry", async () => {
    const res = await request(app)
      .post("/products")
      .send({ name: "Test Widget", ownerId, spec: "initial spec" });

    expect(res.status).toBe(201);
    expect(res.body.currentVersion).toBe(1);
    expect(res.body.currentStage.sequenceOrder).toBe(1);
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.owner.passwordHash).toBeUndefined();

    productId = res.body.id;
  });

  it("auto-projects expectedCompletionDate from the full stage timeline", async () => {
    const [product, stages] = await Promise.all([
      request(app).get(`/products/${productId}`),
      prisma.stageDefinition.findMany(),
    ]);

    const totalExpectedDays = stages.reduce((sum, s) => sum + s.expectedDurationDays, 0);
    const startDate = new Date(product.body.startDate);
    const expectedCompletionDate = new Date(product.body.expectedCompletionDate);
    const projectedDays = Math.round(
      (expectedCompletionDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    expect(projectedDays).toBe(totalExpectedDays);
  });

  it("exposes the per-stage delay breakdown via GET /products/:id/delay", async () => {
    const res = await request(app).get(`/products/${productId}/delay`);

    expect(res.status).toBe(200);
    expect(res.body.delayed).toBe(false);
    expect(res.body.totalDelayDays).toBe(0);
    expect(res.body.stages[0]).toMatchObject({ sequenceOrder: 1, status: "in_progress" });
    expect(res.body.stages[1]).toMatchObject({ sequenceOrder: 2, status: "not_started" });
  });

  it("rejects creation with an unknown ownerId", async () => {
    const res = await request(app)
      .post("/products")
      .send({ name: "Bad Owner", ownerId: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(400);
  });

  it("lists products including the created one", async () => {
    const res = await request(app).get("/products");

    expect(res.status).toBe(200);
    expect(res.body.some((p: { id: string }) => p.id === productId)).toBe(true);
  });

  it("transitions forward to the next stage", async () => {
    const res = await request(app)
      .post(`/products/${productId}/transition`)
      .send({ responsibleUserId });

    expect(res.status).toBe(200);
    expect(res.body.currentStage.sequenceOrder).toBe(2);
    expect(res.body.stageHistory[0].stage.sequenceOrder).toBe(2);
    expect(res.body.stageHistory[1].exitedAt).not.toBeNull();
  });

  it("rejects a backward transition without a reason", async () => {
    const res = await request(app)
      .post(`/products/${productId}/transition`)
      .send({ direction: "backward" });

    expect(res.status).toBe(400);
  });

  it("allows a backward transition when a reason is given", async () => {
    const res = await request(app)
      .post(`/products/${productId}/transition`)
      .send({ direction: "backward", reason: "spec needs rework" });

    expect(res.status).toBe(200);
    expect(res.body.currentStage.sequenceOrder).toBe(1);
  });

  it("rejects moving backward past the first stage", async () => {
    const res = await request(app)
      .post(`/products/${productId}/transition`)
      .send({ direction: "backward", reason: "still testing boundaries" });

    expect(res.status).toBe(400);
  });

  it("creates a new product version and bumps currentVersion", async () => {
    const res = await request(app)
      .post(`/products/${productId}/versions`)
      .send({ spec: "v2 spec" });

    expect(res.status).toBe(201);
    expect(res.body.version.versionNumber).toBe(2);
    expect(res.body.product.currentVersion).toBe(2);
  });

  it("updates product status", async () => {
    const res = await request(app).patch(`/products/${productId}`).send({ status: "DELAYED" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DELAYED");
  });

  it("rejects an invalid status value", async () => {
    const res = await request(app).patch(`/products/${productId}`).send({ status: "NOT_REAL" });

    expect(res.status).toBe(400);
  });

  it("deletes the product", async () => {
    const res = await request(app).delete(`/products/${productId}`);
    expect(res.status).toBe(204);
  });

  it("404s when fetching the deleted product", async () => {
    const res = await request(app).get(`/products/${productId}`);
    expect(res.status).toBe(404);
  });
});
