import type { Prisma } from "@prisma/client";
import type { Db } from "./prismaClient";
import { prisma } from "./prismaClient";

export function create(data: Prisma.AttachmentCreateInput, db: Db = prisma) {
  return db.attachment.create({ data });
}

export function findById(id: string, db: Db = prisma) {
  return db.attachment.findUnique({ where: { id } });
}

// ADR 0013: `assertAttachmentVisible` needs the owning Project id and
// whether the version is confirmed, without loading the full Tech Pack
// detail include just to answer those two questions.
export function findWithVisibilityScope(id: string, db: Db = prisma) {
  return db.attachment.findUnique({
    where: { id },
    select: {
      id: true,
      techPackVersionId: true,
      techPackVersion: {
        select: {
          techPackId: true,
          confirmation: { select: { id: true } },
          techPack: { select: { projectId: true } },
        },
      },
    },
  });
}
