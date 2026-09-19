import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
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
  approvals: {
    orderBy: { decidedAt: "desc" },
    include: {
      decidedBy: { select: safeUserSelect },
      productVersion: { select: { versionNumber: true } },
    },
  },
} satisfies Prisma.ProductInclude;

export function findMany(db: Db = prisma) {
  return db.product.findMany({
    include: listInclude,
    orderBy: { createdAt: "desc" },
  });
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
