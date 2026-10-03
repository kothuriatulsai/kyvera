import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

const include = {
  confirmedBy: { select: safeUserSelect },
} satisfies Prisma.TechPackConfirmationInclude;

export function findByVersion(techPackVersionId: string, db: Db = prisma) {
  return db.techPackConfirmation.findUnique({ where: { techPackVersionId }, include });
}

export function create(data: Prisma.TechPackConfirmationCreateInput, db: Db = prisma) {
  return db.techPackConfirmation.create({ data, include });
}
