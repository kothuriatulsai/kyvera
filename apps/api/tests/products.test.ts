import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { cleanupTestUsers, createTestUser, type TestAgent } from "./helpers/auth";

const app = createApp();
let api: TestAgent;

let ownerId: string;
let responsibleUserId: string;

beforeAll(async () => {
  // An admin: every product is visible and every action is allowed, so this
  // suite keeps exercising the product/workflow behaviour itself. Who may see
  // or do what is covered in access.test.ts.
  api = (await createTestUser(app, "ADMIN")).agent;

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
  await cleanupTestUsers();
  await prisma.$disconnect();
});

describe("Product API", () => {
  let productId: string;

  it("creates a product with an initial version and stage history entry", async () => {
    const res = await api
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
      api.get(`/products/${productId}`),
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
    const res = await api.get(`/products/${productId}/delay`);

    expect(res.status).toBe(200);
    expect(res.body.delayed).toBe(false);
    expect(res.body.totalDelayDays).toBe(0);
    expect(res.body.stages[0]).toMatchObject({ sequenceOrder: 1, status: "in_progress" });
    expect(res.body.stages[1]).toMatchObject({ sequenceOrder: 2, status: "not_started" });
  });

  it("rejects creation with an unknown ownerId", async () => {
    const res = await api
      .post("/products")
      .send({ name: "Bad Owner", ownerId: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(400);
  });

  it("lists products including the created one", async () => {
    const res = await api.get("/products");

    expect(res.status).toBe(200);
    expect(res.body.some((p: { id: string }) => p.id === productId)).toBe(true);
  });

  it("transitions forward to the next stage", async () => {
    const res = await api
      .post(`/products/${productId}/transition`)
      .send({ responsibleUserId });

    expect(res.status).toBe(200);
    expect(res.body.currentStage.sequenceOrder).toBe(2);
    expect(res.body.stageHistory[0].stage.sequenceOrder).toBe(2);
    expect(res.body.stageHistory[1].exitedAt).not.toBeNull();
  });

  it("rejects a backward transition without a reason", async () => {
    const res = await api
      .post(`/products/${productId}/transition`)
      .send({ direction: "backward" });

    expect(res.status).toBe(400);
  });

  it("allows a backward transition when a reason is given", async () => {
    const res = await api
      .post(`/products/${productId}/transition`)
      .send({ direction: "backward", reason: "spec needs rework" });

    expect(res.status).toBe(200);
    expect(res.body.currentStage.sequenceOrder).toBe(1);
  });

  it("rejects moving backward past the first stage", async () => {
    const res = await api
      .post(`/products/${productId}/transition`)
      .send({ direction: "backward", reason: "still testing boundaries" });

    expect(res.status).toBe(400);
  });

  it("creates a new product version and bumps currentVersion", async () => {
    const res = await api
      .post(`/products/${productId}/versions`)
      .send({ spec: "v2 spec" });

    expect(res.status).toBe(201);
    expect(res.body.version.versionNumber).toBe(2);
    expect(res.body.product.currentVersion).toBe(2);
  });

  it("rejects setting a derived status manually instead of silently ignoring it", async () => {
    const delayed = await api.patch(`/products/${productId}`).send({ status: "DELAYED" });
    expect(delayed.status).toBe(400);
    expect(delayed.body.error).toMatch(/derived from delay computation; only BLOCKED/);

    // ON_TRACK is only meaningful as "clear a block"; this product isn't blocked.
    const onTrack = await api.patch(`/products/${productId}`).send({ status: "ON_TRACK" });
    expect(onTrack.status).toBe(400);

    const stored = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(stored.status).toBe("ON_TRACK");
  });

  it("allows BLOCKED to be set manually", async () => {
    const res = await api.patch(`/products/${productId}`).send({ status: "BLOCKED" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("BLOCKED");
  });

  it("rejects DELAYED on a blocked product, and lets ON_TRACK clear the block", async () => {
    const delayed = await api.patch(`/products/${productId}`).send({ status: "DELAYED" });
    expect(delayed.status).toBe(400);

    const cleared = await api.patch(`/products/${productId}`).send({ status: "ON_TRACK" });
    expect(cleared.status).toBe(200);
    // Re-derived from the delay computation, not taken from the request: this
    // product is on schedule.
    expect(cleared.body.status).toBe("ON_TRACK");
  });

  it("still applies other fields alongside a valid status", async () => {
    const res = await api
      .patch(`/products/${productId}`)
      .send({ name: "Renamed Widget", status: "BLOCKED" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Renamed Widget", status: "BLOCKED" });
  });

  it("does not apply any field from a request whose status is rejected", async () => {
    const res = await api
      .patch(`/products/${productId}`)
      .send({ name: "Should Not Apply", status: "DELAYED" });

    expect(res.status).toBe(400);
    const stored = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(stored.name).toBe("Renamed Widget");
  });

  it("rejects an invalid status value", async () => {
    const res = await api.patch(`/products/${productId}`).send({ status: "NOT_REAL" });

    expect(res.status).toBe(400);
  });

  it("deletes the product", async () => {
    const res = await api.delete(`/products/${productId}`);
    expect(res.status).toBe(204);
  });

  it("404s when fetching the deleted product", async () => {
    const res = await api.get(`/products/${productId}`);
    expect(res.status).toBe(404);
  });
});
