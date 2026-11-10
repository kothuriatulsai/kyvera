import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

// Step 21's "remarks/chat updates" (ADR 0015) - same scoped-functional-table
// shape as techPackRemarkRepository, not the generic `comments` table ADR
// 0004 deferred.
export function create(data: Prisma.ProtoWorkUpdateCreateInput, db: Db = prisma) {
  return db.protoWorkUpdate.create({ data });
}

export function findByProtoWork(protoWorkId: string, db: Db = prisma) {
  return db.protoWorkUpdate.findMany({ where: { protoWorkId }, orderBy: { createdAt: "asc" } });
}
