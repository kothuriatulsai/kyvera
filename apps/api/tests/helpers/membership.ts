import { prisma } from "../../src/repositories/prismaClient";

/**
 * Direct write, bypassing the API - same reasoning as `createTestUser`: most
 * tests exercising ADR 0013's stage-level rules don't care about the
 * membership-management endpoints themselves (those have their own tests),
 * they just need a non-see-all actor to already be a member of a Project
 * before testing what they can/can't do once they are.
 */
export async function addMember(projectId: string, userId: string, addedById: string = userId) {
  await prisma.projectMember.create({
    data: {
      project: { connect: { id: projectId } },
      user: { connect: { id: userId } },
      addedBy: { connect: { id: addedById } },
    },
  });
}
