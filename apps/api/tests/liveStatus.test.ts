import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";

const app = createApp();

const OVERRUN_DAYS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let ownerId: string;
let onTimeId: string;
let overrunId: string;
const createdProductIds: string[] = [];

async function createProduct(name: string): Promise<string> {
  const res = await request(app).post("/products").send({ name, ownerId });
  expect(res.status).toBe(201);
  createdProductIds.push(res.body.id);
  return res.body.id;
}

interface ListedProduct {
  id: string;
  status: string;
  delay: { delayed: boolean; totalDelayDays: number; expectedCompletionDate: string };
}

async function listedProduct(id: string): Promise<ListedProduct> {
  const res = await request(app).get("/products");
  expect(res.status).toBe(200);
  return (res.body as ListedProduct[]).find((p) => p.id === id)!;
}

beforeAll(async () => {
  const firstStage = await prisma.stageDefinition.findUnique({ where: { sequenceOrder: 1 } });
  if (!firstStage) {
    throw new Error(
      "stage_definitions is empty — run `npm run db:seed --workspace apps/api` before testing",
    );
  }

  const owner = await prisma.user.create({
    data: {
      name: "Live Status Test Owner",
      email: `test-live-${randomUUID()}@kyvera.test`,
      role: "MANAGER",
      passwordHash: "test",
    },
  });
  ownerId = owner.id;

  onTimeId = await createProduct("On Time Widget");
  overrunId = await createProduct("Overrun Widget");

  // Simulate time passing without any transition: the open stage has now run
  // OVERRUN_DAYS past its expected duration. Nothing recomputes the stored
  // status, which is exactly the situation the live read exists for.
  await prisma.productStageHistory.updateMany({
    where: { productId: overrunId, exitedAt: null },
    data: {
      enteredAt: new Date(
        Date.now() - (firstStage.expectedDurationDays + OVERRUN_DAYS) * MS_PER_DAY,
      ),
    },
  });
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

describe("Live product status", () => {
  it("leaves the stored status stale for a product that overran without transitioning", async () => {
    const stored = await prisma.product.findUniqueOrThrow({ where: { id: overrunId } });
    expect(stored.status).toBe("ON_TRACK");
  });

  it("returns DELAYED with a delay summary from GET /products", async () => {
    const product = await listedProduct(overrunId);

    expect(product.status).toBe("DELAYED");
    expect(product.delay.delayed).toBe(true);
    expect(product.delay.totalDelayDays).toBe(OVERRUN_DAYS);
  });

  it("keeps an on-time product ON_TRACK", async () => {
    const product = await listedProduct(onTimeId);

    expect(product.status).toBe("ON_TRACK");
    expect(product.delay).toMatchObject({ delayed: false, totalDelayDays: 0 });
  });

  it("agrees with GET /products/:id and the /delay endpoint", async () => {
    const listed = await listedProduct(overrunId);
    const detail = await request(app).get(`/products/${overrunId}`);
    const delay = await request(app).get(`/products/${overrunId}/delay`);

    expect(detail.body.status).toBe(listed.status);
    expect(detail.body.delay.totalDelayDays).toBe(delay.body.totalDelayDays);
    expect(listed.delay.totalDelayDays).toBe(delay.body.totalDelayDays);
    expect(listed.delay.expectedCompletionDate).toBe(delay.body.expectedCompletionDate);
  });

  it("does not override a manually-set BLOCKED status", async () => {
    const patched = await request(app).patch(`/products/${overrunId}`).send({ status: "BLOCKED" });
    expect(patched.status).toBe(200);

    const product = await listedProduct(overrunId);

    expect(product.status).toBe("BLOCKED");
    // Still reports the delay itself, just doesn't turn BLOCKED into DELAYED.
    expect(product.delay.delayed).toBe(true);
  });

  it("handles a product with no stage history", async () => {
    // A product whose history was removed must not break the batched read.
    const bareId = await createProduct("No History Widget");
    await prisma.productStageHistory.deleteMany({ where: { productId: bareId } });

    const product = await listedProduct(bareId);

    expect(product.status).toBe("ON_TRACK");
    expect(product.delay.delayed).toBe(false);
  });
});
