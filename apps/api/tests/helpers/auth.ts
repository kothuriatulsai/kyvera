import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { prisma } from "../../src/repositories/prismaClient";
import * as sessionService from "../../src/services/sessionService";
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
 * A real user row, a real `UserSession` row, and an agent that authenticates
 * as them with a token minted for that session. Both rows matter:
 * `authenticate` loads the user (and their current role) on every request,
 * so a token for an id with no row is rejected - and since ADR 0012, it also
 * checks the token's `sid` against a real, non-revoked session, so a token
 * with no matching session is rejected too.
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

  const { sessionId } = await sessionService.createSession(user.id, "test-agent");
  const { token } = signAccessToken({ id: user.id, role }, sessionId);
  return {
    id: user.id,
    role,
    name,
    email: user.email,
    agent: request.agent(app).set("Authorization", `Bearer ${token}`),
  };
}

/**
 * Removes the users made by `createTestUser`. Every SOP relation to `User` is
 * `onDelete: Restrict` (ADR 0006, point 9), so call this *after* deleting any
 * row a test user created (a Project, TechPack, remark, confirmation,
 * approval, attachment) - otherwise this delete fails with a foreign key
 * violation instead of silently succeeding. `UserSession` rows are
 * `onDelete: Cascade` (ADR 0012) and need no separate cleanup here.
 *
 * `Notification` rows (ADR 0014) *are* cleaned up here, not left to each test
 * file: unlike a Project/TechPack/etc., a test never creates these directly -
 * they're a side effect of some other action, addressed to a recipient the
 * test may not have a handle on at all (e.g. every ENGINEERING member of a
 * Project, not just the one actor under test) - so there's no single "delete
 * what I made" call site for them to live at.
 */
export async function cleanupTestUsers() {
  await prisma.notification.deleteMany({ where: { recipientId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
}
