import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { assignmentInclude } from "./assignmentRepository";
import { safeUserSelect } from "./selects";

const listInclude = {
  owner: { select: safeUserSelect },
  currentStage: true,
} satisfies Prisma.ProductInclude;

const detailInclude = {
  owner: { select: safeUserSelect },
  currentStage: true,
  versions: {
    orderBy: { versionNumber: "desc" },
    include: { createdBy: { select: safeUserSelect } },
  },
  stageHistory: {
    orderBy: { enteredAt: "desc" },
    include: { stage: true, responsibleUser: { select: safeUserSelect } },
  },
  assignments: {
    include: assignmentInclude,
    orderBy: [{ stage: { sequenceOrder: "asc" } }, { assignedAt: "asc" }],
  },
  progressNotes: {
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true } } },
  },
  approvals: {
    orderBy: { decidedAt: "desc" },
    include: {
      decidedBy: { select: safeUserSelect },
      productVersion: { select: { versionNumber: true } },
    },
  },
} satisfies Prisma.ProductInclude;

// Products matching `where`, each carrying only *the given user's* assignments
// on it - which is all that's needed to decide what that user may see. Other
// people's assignments are never loaded for a list.
export function findManyForViewer(
  where: Prisma.ProductWhereInput,
  viewerId: string,
  db: Db = prisma,
) {
  return db.product.findMany({
    where,
    include: {
      ...listInclude,
      assignments: { where: { userId: viewerId }, include: { stage: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export function existsWhere(where: Prisma.ProductWhereInput, db: Db = prisma) {
  return db.product.findFirst({ where, select: { id: true } }).then((row) => row !== null);
}

export function findById(id: string, db: Db = prisma) {
  return db.product.findUnique({ where: { id }, include: detailInclude });
}

export function findByIdWithCurrentStage(id: string, db: Db = prisma) {
  return db.product.findUnique({ where: { id }, include: { currentStage: true } });
}

export function create(data: Prisma.ProductCreateInput, db: Db = prisma) {
  return db.product.create({ data, include: listInclude });
}

export function update(id: string, data: Prisma.ProductUpdateInput, db: Db = prisma) {
  return db.product.update({ where: { id }, data, include: listInclude });
}

export function remove(id: string, db: Db = prisma) {
  return db.product.delete({ where: { id } });
}
