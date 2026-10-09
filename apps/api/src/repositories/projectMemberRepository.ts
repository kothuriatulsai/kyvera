import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

const memberInclude = {
  user: { select: safeUserSelect },
  addedBy: { select: safeUserSelect },
} satisfies Prisma.ProjectMemberInclude;

export function findByProject(projectId: string, db: Db = prisma) {
  return db.projectMember.findMany({
    where: { projectId },
    include: memberInclude,
    orderBy: { addedAt: "asc" },
  });
}

export function findByProjectAndUser(projectId: string, userId: string, db: Db = prisma) {
  return db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
}

// Every projectId a user is a member of - the input to layer A's list/detail
// filtering for a non-see-all role (services/visibility.ts).
export function findProjectIdsForUser(userId: string, db: Db = prisma) {
  return db.projectMember.findMany({ where: { userId }, select: { projectId: true } });
}

// The "other direction" of findByProject - a user's own membership list, for
// the Users page's per-user Projects view (ADR 0013).
export function findProjectsForUser(userId: string, db: Db = prisma) {
  return db.projectMember.findMany({
    where: { userId },
    include: { project: { select: { id: true, code: true, name: true } } },
    orderBy: { addedAt: "asc" },
  });
}

export function create(data: Prisma.ProjectMemberCreateInput, db: Db = prisma) {
  return db.projectMember.create({ data, include: memberInclude });
}

export function remove(projectId: string, userId: string, db: Db = prisma) {
  return db.projectMember.delete({ where: { projectId_userId: { projectId, userId } } });
}

export function createHistoryEntry(
  data: Prisma.ProjectMemberHistoryCreateInput,
  db: Db = prisma,
) {
  return db.projectMemberHistory.create({ data });
}
