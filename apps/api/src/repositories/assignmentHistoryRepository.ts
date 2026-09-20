import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

// Append-only audit trail (docs/architecture/0004): no update or delete here.
export function create(data: Prisma.ProductStageAssignmentHistoryCreateInput, db: Db = prisma) {
  return db.productStageAssignmentHistory.create({ data });
}
