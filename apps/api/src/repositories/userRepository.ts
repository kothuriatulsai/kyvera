import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

export function findById(id: string, db: Db = prisma) {
  return db.user.findUnique({ where: { id } });
}
