import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Stage API", () => {
  it("lists workflow stages in sequence order", async () => {
    const res = await request(app).get("/stages");

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);

    const orders = (res.body as { sequenceOrder: number }[]).map((s) => s.sequenceOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(res.body[0]).toMatchObject({
      name: expect.any(String),
      expectedDurationDays: expect.any(Number),
    });
  });
});
