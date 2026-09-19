import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

export function findAll(db: Db = prisma) {
  return db.stageDefinition.findMany({ orderBy: { sequenceOrder: "asc" } });
}

export function findBySequenceOrder(sequenceOrder: number, db: Db = prisma) {
  return db.stageDefinition.findUnique({ where: { sequenceOrder } });
}

export function findFirst(db: Db = prisma) {
  return findBySequenceOrder(1, db);
}

export function findLast(db: Db = prisma) {
  return db.stageDefinition.findFirst({ orderBy: { sequenceOrder: "desc" } });
}
