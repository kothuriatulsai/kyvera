import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

// What an admin/owner/manager sees of an assignment: who, on which stage, and
// whether they've signed off.
export const assignmentInclude = {
  stage: true,
  user: { select: safeUserSelect },
  assignedBy: { select: safeUserSelect },
} satisfies Prisma.ProductStageAssignmentInclude;

export function create(data: Prisma.ProductStageAssignmentCreateInput, db: Db = prisma) {
  return db.productStageAssignment.create({ data, include: assignmentInclude });
}

export function findById(id: string, db: Db = prisma) {
  return db.productStageAssignment.findUnique({ where: { id } });
}

/** One user's assignments on one product (what decides that user's access to it). */
export function findByProductAndUser(productId: string, userId: string, db: Db = prisma) {
  return db.productStageAssignment.findMany({
    where: { productId, userId },
    include: { stage: true },
    orderBy: { stage: { sequenceOrder: "asc" } },
  });
}

/** Everyone assigned to one stage of a product (for the sign-off check). */
export function findByProductAndStage(productId: string, stageId: string, db: Db = prisma) {
  return db.productStageAssignment.findMany({ where: { productId, stageId } });
}

export function findByUser(userId: string, db: Db = prisma) {
  return db.productStageAssignment.findMany({ where: { userId }, include: { stage: true } });
}

export function remove(id: string, db: Db = prisma) {
  return db.productStageAssignment.delete({ where: { id } });
}

export function markReady(id: string, readyAt: Date, db: Db = prisma) {
  return db.productStageAssignment.update({
    where: { id },
    data: { readyAt },
    include: assignmentInclude,
  });
}

/** A fresh visit to a stage starts a fresh sign-off. */
export function clearReady(productId: string, stageId: string, db: Db = prisma) {
  return db.productStageAssignment.updateMany({
    where: { productId, stageId, readyAt: { not: null } },
    data: { readyAt: null },
  });
}
