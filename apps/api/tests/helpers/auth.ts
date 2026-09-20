import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { prisma } from "../../src/repositories/prismaClient";
import { signAccessToken } from "../../src/services/tokenService";

export type TestAgent = ReturnType<typeof request.agent>;

export interface TestUser {
  id: string;
  role: UserRole;
  name: string;
  email: string;
  /** Sends this user's token on every request. */
  agent: TestAgent;
}

const createdUserIds: string[] = [];

/**
 * A real user row plus an agent that authenticates as them. The row matters:
 * `authenticate` loads the user (and their current role) on every request, so a
 * token for an id with no row is rejected.
 */
export async function createTestUser(
  app: Express,
  role: UserRole,
  label = role.toLowerCase(),
): Promise<TestUser> {
  const name = `Test ${label}`;
  const user = await prisma.user.create({
    data: {
      name,
      email: `test-${label}-${randomUUID()}@kyvera.test`,
      role,
      passwordHash: "test",
    },
  });
  createdUserIds.push(user.id);

  const { token } = signAccessToken({ id: user.id, role });
  return {
    id: user.id,
    role,
    name,
    email: user.email,
    agent: request.agent(app).set("Authorization", `Bearer ${token}`),
  };
}

/**
 * Removes the users made by `createTestUser`. Call it *after* deleting the
 * products the suite created: assignments, history, notes and approvals all
 * cascade from the product, and they'd otherwise block deleting the users.
 */
export async function cleanupTestUsers() {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
}
