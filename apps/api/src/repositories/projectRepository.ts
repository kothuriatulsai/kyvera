import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

const include = {
  createdBy: { select: safeUserSelect },
} satisfies Prisma.ProjectInclude;

export function findMany(where: Prisma.ProjectWhereInput = {}, db: Db = prisma) {
  return db.project.findMany({ where, include, orderBy: { createdAt: "desc" } });
}

export function findById(id: string, db: Db = prisma) {
  return db.project.findUnique({ where: { id }, include });
}

// A narrow existence check for `visibility.assertProjectVisible` (ADR 0013)
// - a see-all role's visibility check would otherwise never notice a
// nonexistent projectId, since it returns before any membership lookup
// (which is what gives a non-see-all role's check that existence check for
// free).
export function exists(id: string, db: Db = prisma) {
  return db.project.findUnique({ where: { id }, select: { id: true } }).then((row) => row !== null);
}

export function create(data: Prisma.ProjectCreateInput, db: Db = prisma) {
  return db.project.create({ data, include });
}

// Locks the row for the life of the enclosing transaction - used by
// techPackService.createTechPack so the "at most one non-voided TechPack per
// Project per phase" check and the insert that follows it can't race a
// concurrent create for the same Project. Same raw-query pattern as
// techPackRepository.lockById (Prisma has no typed `SELECT ... FOR UPDATE`).
export async function lockById(id: string, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${id} FOR UPDATE`;
  return tx.project.findUnique({ where: { id } });
}
