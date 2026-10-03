import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

export function create(data: Prisma.AttachmentCreateInput, db: Db = prisma) {
  return db.attachment.create({ data });
}

export function findById(id: string, db: Db = prisma) {
  return db.attachment.findUnique({ where: { id } });
}
