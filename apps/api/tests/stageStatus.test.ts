import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { cleanupTestUsers, createTestUser, type TestUser } from "./helpers/auth";

const app = createApp();

let admin: TestUser;
let productId: string;

async function statuses() {
  const res = await admin.agent.get(`/products/${productId}/delay`);
  expect(res.status).toBe(200);
  // Just the first four stages, which is all these tests move between.
  return (res.body.stages as { status: string }[]).slice(0, 4).map((s) => s.status);
}

const forward = () => admin.agent.post(`/products/${productId}/transition`).send({});
const back = () =>
  admin.agent
    .post(`/products/${productId}/transition`)
    .send({ direction: "backward", reason: "rework" });

beforeAll(async () => {
  admin = await createTestUser(app, "ADMIN");
  const created = await admin.agent.post("/products").send({ name: "Status Widget", ownerId: admin.id });
  expect(created.status).toBe(201);
  productId = created.body.id;
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: productId } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

// A stage the product was sent back from used to be reported "completed".
describe("stage status after moving a product backward", () => {
  it("is in progress at the start, with nothing else started", async () => {
    expect(await statuses()).toEqual(["in_progress", "not_started", "not_started", "not_started"]);
  });

  it("marks stages completed as the product moves forward", async () => {
    expect((await forward()).status).toBe(200); // -> stage 2
    expect((await forward()).status).toBe(200); // -> stage 3
    expect(await statuses()).toEqual(["completed", "completed", "in_progress", "not_started"]);
  });

  it("calls the stage it was sent back from 'sent back', not 'completed'", async () => {
    expect((await back()).status).toBe(200); // 3 -> 2

    expect(await statuses()).toEqual(["completed", "in_progress", "sent_back", "not_started"]);
  });

  it("does the same for every stage it is sent back past", async () => {
    expect((await back()).status).toBe(200); // 2 -> 1

    expect(await statuses()).toEqual(["in_progress", "sent_back", "sent_back", "not_started"]);
  });

  it("returns to completed and in progress as it moves forward again", async () => {
    expect((await forward()).status).toBe(200); // 1 -> 2

    expect(await statuses()).toEqual(["completed", "in_progress", "sent_back", "not_started"]);
  });

  it("does not change what the move-back did to the product's status or dates", async () => {
    // Only the label changed: the product is exactly as on time as it was.
    const product = await admin.agent.get(`/products/${productId}`);
    expect(product.body.status).toBe("ON_TRACK");
    expect(product.body.delay.delayed).toBe(false);
  });
});
