import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";
import { safeUserSelect } from "./selects";

export function findById(id: string, db: Db = prisma) {
  return db.user.findUnique({ where: { id } });
}

// The full row, including passwordHash — for authentication internals only.
export function findByEmail(email: string, db: Db = prisma) {
  return db.user.findUnique({ where: { email } });
}

// Never includes passwordHash, so it's safe to hand back from an endpoint.
export function findSafeById(id: string, db: Db = prisma) {
  return db.user.findUnique({ where: { id }, select: safeUserSelect });
}

export function create(data: Prisma.UserCreateInput, db: Db = prisma) {
  return db.user.create({ data, select: safeUserSelect });
}
