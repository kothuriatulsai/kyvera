import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

export function create(data: Prisma.TechPackApprovalCreateInput, db: Db = prisma) {
  return db.techPackApproval.create({ data });
}
