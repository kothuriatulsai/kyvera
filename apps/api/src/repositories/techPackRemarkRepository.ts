import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

const include = {
  author: { select: safeUserSelect },
} satisfies Prisma.TechPackRemarkInclude;

// Oldest first - a review thread reads top-to-bottom, like a chat log.
export function findByVersion(techPackVersionId: string, db: Db = prisma) {
  return db.techPackRemark.findMany({
    where: { techPackVersionId },
    include,
    orderBy: { createdAt: "asc" },
  });
}

export function create(data: Prisma.TechPackRemarkCreateInput, db: Db = prisma) {
  return db.techPackRemark.create({ data, include });
}
