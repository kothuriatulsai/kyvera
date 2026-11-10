import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/repositories/prismaClient";
import { cleanupTestUsers, createTestUser } from "./helpers/auth";

const app = createApp();

const createdManufacturerIds: string[] = [];

afterAll(async () => {
  await prisma.manufacturerMaster.deleteMany({ where: { id: { in: createdManufacturerIds } } });
  await cleanupTestUsers();
  await prisma.$disconnect();
});

type Agent = Awaited<ReturnType<typeof createTestUser>>["agent"];

async function createManufacturer(agent: Agent, body: Record<string, unknown> = {}) {
  const res = await agent.post("/manufacturers").send({ name: "Acme Fabrication", ...body });
  if (res.status === 201) createdManufacturerIds.push(res.body.id);
  return res;
}

const NON_PMO_ADMIN: UserRole[] = [
  "FINANCE",
  "PRODUCT_DESIGNER",
  "ENGINEERING",
  "MANAGEMENT",
  "MERCHANDISER",
];

describe("Manufacturer master (ADR 0015)", () => {
  it.each(["PMO", "ADMIN"] as UserRole[])("%s creates, lists, updates, deactivates and reactivates one", async (role) => {
    const { agent } = await createTestUser(app, role);

    const created = await createManufacturer(agent, {
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
    });
    expect(created.status).toBe(201);
    expect(created.body.isActive).toBe(true);
    expect(created.body.contactName).toBe("Jane Doe");
    const id = created.body.id as string;

    const list = await agent.get("/manufacturers");
    expect(list.status).toBe(200);
    expect(list.body.some((m: { id: string }) => m.id === id)).toBe(true);

    const updated = await agent.patch(`/manufacturers/${id}`).send({ contactPhone: "+1-555-0100" });
    expect(updated.status).toBe(200);
    expect(updated.body.contactPhone).toBe("+1-555-0100");
    expect(updated.body.name).toBe("Acme Fabrication");

    const deactivated = await agent.post(`/manufacturers/${id}/deactivate`);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.isActive).toBe(false);

    // Deactivated manufacturers are excluded from the default (picker) list.
    const listAfterDeactivate = await agent.get("/manufacturers");
    expect(listAfterDeactivate.body.some((m: { id: string }) => m.id === id)).toBe(false);
    const listIncludingInactive = await agent.get("/manufacturers?includeInactive=true");
    expect(listIncludingInactive.body.some((m: { id: string }) => m.id === id)).toBe(true);

    const reactivated = await agent.post(`/manufacturers/${id}/reactivate`);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.isActive).toBe(true);
  });

  it.each(NON_PMO_ADMIN)("forbids %s from every endpoint", async (role) => {
    const { agent } = await createTestUser(app, role);

    expect((await agent.get("/manufacturers")).status).toBe(403);
    expect((await createManufacturer(agent)).status).toBe(403);
  });

  it("404s an unknown manufacturer id", async () => {
    const { agent } = await createTestUser(app, "PMO");

    const res = await agent.patch("/manufacturers/00000000-0000-0000-0000-000000000000").send({ name: "x" });

    expect(res.status).toBe(404);
  });

  it("requires a non-empty name", async () => {
    const { agent } = await createTestUser(app, "PMO");

    const res = await createManufacturer(agent, { name: "   " });

    expect(res.status).toBe(400);
  });
});
