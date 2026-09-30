import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

const include = {
  createdBy: { select: safeUserSelect },
} satisfies Prisma.ProjectInclude;

export function findMany(db: Db = prisma) {
  return db.project.findMany({ include, orderBy: { createdAt: "desc" } });
}

export function findById(id: string, db: Db = prisma) {
  return db.project.findUnique({ where: { id }, include });
}

export function create(data: Prisma.ProjectCreateInput, db: Db = prisma) {
  return db.project.create({ data, include });
}
