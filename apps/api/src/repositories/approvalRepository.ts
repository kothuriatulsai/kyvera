import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

// Approvals are append-only (see docs/architecture/0005), so there is
// deliberately no update or delete here.
export function create(data: Prisma.ApprovalCreateInput, db: Db = prisma) {
  return db.approval.create({ data });
}
